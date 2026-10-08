import { NextResponse } from "next/server";
import { askOpportunitySelection } from "../../../../lib/agent-brain";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

const DIMENSIONS = ["demand","access","margin","repeatability","risk"];

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("x-agent-worker-secret") === secret;
}

function fullyVerified(row:any) {
  return DIMENSIONS.every((key) => {
    const value = String(row?.[key] || "UNVERIFIED");
    return value === "CHECKED" || value === "STRONG";
  });
}

function fallbackSelection(candidates:any[], evidence:any[]) {
  const ranked = candidates.map((candidate:any) => {
    const rows = evidence.filter((e:any) => String(e?.opportunity_id || "") === String(candidate.id));
    const evidenceScore = rows.reduce((sum:number,row:any) => {
      const quality=String(row?.quality||"UNVERIFIED");
      return sum + (quality==="STRONG" ? 3 : quality==="CHECKED" ? 1 : 0);
    },0);
    const priority = Number(candidate?.researchPriority || 0);
    const confidence = Number(candidate?.researchConfidence || 0);
    return {
      id:String(candidate.id),
      score:priority * 2 + confidence + evidenceScore * 5
    };
  }).sort((a,b)=>b.score-a.score);
  return ranked[0] || null;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ok:false,error:"Selection worker is not authorized."},{status:401});
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
  }

  try {
    const [runs, opportunities, verificationRows, evidence, researchCandidates] = await Promise.all([
      supabaseRequest("discovery_runs?mode=eq.OWNER_APPROVAL_EXECUTION&order=created_at.desc&limit=1&select=*"),
      supabaseRequest("opportunities?select=*"),
      supabaseRequest("opportunity_verification?select=*"),
      supabaseRequest("evidence?select=*&order=created_at.desc"),
      supabaseRequest("research_candidates?select=run_id,name,pursuit_priority,confidence")
    ]);

    const run = Array.isArray(runs) ? runs[0] : null;
    const runId = String(run?.id || "");
    const allOpportunities = Array.isArray(opportunities) ? opportunities : [];
    const verification = Array.isArray(verificationRows) ? verificationRows : [];
    const allEvidence = Array.isArray(evidence) ? evidence : [];
    const candidatesForRun = runId
      ? allOpportunities.filter((op:any)=>String(op?.id||"").startsWith("research-"+runId+"-"))
      : allOpportunities;

    const selectedExisting = candidatesForRun.find((op:any)=>String(op?.status||"").toUpperCase()==="SELECTED");
    if (selectedExisting) {
      return NextResponse.json({
        ok:true,
        selected:true,
        opportunityId:String(selectedExisting.id),
        opportunityName:String(selectedExisting.name||""),
        reason:String(selectedExisting.next_action||"Winner already selected.")
      });
    }

    const verificationById = new Map(verification.map((row:any)=>[String(row?.opportunity_id||""),row]));
    const verifiedCandidates = candidatesForRun
      .filter((op:any)=>!["QUEUED_CAPITAL","REJECTED","BLOCKED"].includes(String(op?.status||"").toUpperCase()))
      .filter((op:any)=>fullyVerified(verificationById.get(String(op.id))))
      .map((op:any)=>{
        const research = Array.isArray(researchCandidates)
          ? researchCandidates
              .filter((r:any)=>String(r?.run_id||"")===runId && String(r?.name||"")===String(op?.name||""))
              .sort((a:any,b:any)=>String(b?.run_id||"").localeCompare(String(a?.run_id||"")))[0]
          : null;
        return {
          ...op,
          researchPriority:Number(research?.pursuit_priority||0),
          researchConfidence:Number(research?.confidence||0)
        };
      });

    if (verifiedCandidates.length === 0) {
      return NextResponse.json({
        ok:false,
        error:"Selection is blocked because the current research set is not fully verified yet."
      },{status:409});
    }

    const grouped:Record<string,Record<string,string>>={};
    for (const row of verification) {
      const id=String(row?.opportunity_id||"");
      if (!id) continue;
      grouped[id]={};
      for (const key of DIMENSIONS) grouped[id][key]=String(row?.[key]||"UNVERIFIED");
    }

    const aiSelection = await askOpportunitySelection({
      opportunities:verifiedCandidates,
      verification:grouped,
      evidence:allEvidence
    });

    const fallback = fallbackSelection(verifiedCandidates, allEvidence);
    const winnerId = aiSelection?.opportunityId || fallback?.id;
    if (!winnerId) {
      return NextResponse.json({ok:false,error:"The selection brain could not identify a verified winner."},{status:502});
    }

    const winner = verifiedCandidates.find((op:any)=>String(op.id)===winnerId);
    if (!winner) {
      return NextResponse.json({ok:false,error:"The selected winner was not part of the verified research set."},{status:502});
    }

    const reason = aiSelection?.reason || "Selected by deterministic fallback using research priority, confidence and evidence quality.";
    for (const op of candidatesForRun) {
      const isWinner=String(op.id)===winnerId;
      await supabaseRequest("opportunities?id=eq."+encodeURIComponent(String(op.id)),{
        method:"PATCH",
        body:JSON.stringify({
          status:isWinner ? "SELECTED" : "VERIFIED",
          next_action:isWinner
            ? "Build monetization plan. Selection rationale: " + reason
            : "Verified candidate; not selected for the first monetization test."
        }),
        headers:{"Prefer":"return=minimal"}
      });
    }

    const readyMonetizationTasks = await supabaseRequest(
      "tasks?status=eq.READY&title=ilike.*build%20monetization%20plan*&select=*"
    );
    if (Array.isArray(readyMonetizationTasks)) {
      for (const task of readyMonetizationTasks) {
        if (String(task?.opportunity_id||"") !== winnerId && task?.id) {
          await supabaseRequest("tasks?id=eq."+encodeURIComponent(String(task.id)),{
            method:"PATCH",
            body:JSON.stringify({status:"BLOCKED"}),
            headers:{"Prefer":"return=minimal"}
          });
        }
      }
    }

    const winnerTasks = await supabaseRequest(
      "tasks?opportunity_id=eq."+encodeURIComponent(winnerId)+"&select=*"
    );
    const existingPlan = Array.isArray(winnerTasks)
      ? winnerTasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("build monetization plan"))
      : null;

    if (existingPlan?.id) {
      await supabaseRequest("tasks?id=eq."+encodeURIComponent(String(existingPlan.id)),{
        method:"PATCH",
        body:JSON.stringify({status:"READY"}),
        headers:{"Prefer":"return=minimal"}
      });
    } else {
      const taskId="research-"+winnerId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-monetization";
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({
          id:taskId,
          title:"Build monetization plan: "+String(winner.name||"selected opportunity"),
          status:"READY",
          opportunity_id:winnerId
        }),
        headers:{"Prefer":"return=minimal"}
      });
    }

    return NextResponse.json({
      ok:true,
      selected:true,
      opportunityId:winnerId,
      opportunityName:String(winner.name||""),
      reason,
      selectionBrain:aiSelection ? "AI" : "DETERMINISTIC_FALLBACK",
      verifiedCandidates:verifiedCandidates.map((op:any)=>String(op.name||op.id))
    });
  } catch(error) {
    const message=error instanceof Error ? error.message : "Opportunity selection failed.";
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
