import { NextResponse } from "next/server";
import { getNextAction } from "../../../../lib/agent-core";
import { askBusinessBrain } from "../../../../lib/agent-brain";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

const fallback = {
  tasks: [
    { id:"t1", title:"Verify the first zero-capital business workflow", status:"READY", opportunity_id:"lead-research" },
    { id:"t2", title:"Define evidence for opportunity verification", status:"READY", opportunity_id:"lead-research" },
    { id:"t3", title:"Select the first micro-service to prototype", status:"READY", opportunity_id:"micro-service" }
  ],
  approvals: [],
  verification: {}
};

const stateRank: Record<string, number> = { UNVERIFIED: 1, CHECKED: 2, STRONG: 3 };

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ configured:false, brain:"DETERMINISTIC", action:getNextAction(fallback) });
  }

  try {
    const [tasks, approvals, verification, opportunities, evidence] = await Promise.all([
      supabaseRequest("tasks?select=*&order=created_at.asc"),
      supabaseRequest("approvals?select=*&order=created_at.desc"),
      supabaseRequest("opportunity_verification?select=*"),
      supabaseRequest("opportunities?select=*&order=created_at.desc"),
      supabaseRequest("evidence?select=*&order=created_at.desc")
    ]);

    const liveTasks = Array.isArray(tasks) ? tasks : [];
    const liveApprovals = Array.isArray(approvals) ? approvals : [];
    const liveOpportunities = Array.isArray(opportunities) ? opportunities : [];
    const liveEvidence = Array.isArray(evidence) ? evidence : [];

    const grouped: Record<string, Record<string, string>> = {};
    for (const row of Array.isArray(verification) ? verification : []) {
      const opportunityId = String(row?.opportunity_id || "");
      if (!opportunityId) continue;
      const current = grouped[opportunityId] || {};
      for (const dimension of ["demand","access","margin","repeatability","risk"]) {
        const incoming = String(row?.[dimension] || "UNVERIFIED");
        const existing = current[dimension] || "UNVERIFIED";
        current[dimension] = (stateRank[incoming] || 0) >= (stateRank[existing] || 0) ? incoming : existing;
      }
      grouped[opportunityId] = current;
    }

    const state = {
      tasks: liveTasks,
      approvals: liveApprovals,
      verification: grouped,
      opportunities: liveOpportunities,
      evidence: liveEvidence
    };

    const deterministic = getNextAction({
      tasks: liveTasks,
      approvals: liveApprovals,
      verification: grouped
    });

    // Safety-critical ordering stays deterministic: pending approvals and
    // unfinished verification cannot be overridden by the language model.
    if (deterministic.status === "WAITING" || /^Verify /.test(deterministic.action)) {
      return NextResponse.json({ configured:true, brain:"DETERMINISTIC", action:deterministic });
    }
    // "Select verified opportunity..." is a planning signal. Let the AI brain
    // compare the complete verified set and return the actual monetization action.


    const ai = await askBusinessBrain(state);
    if (ai) {
      const readyTitles = liveTasks
        .filter((t:any)=>String(t?.status||"")==="READY")
        .map((t:any)=>String(t?.title||"").toLowerCase());

      const validForLedger =
        (ai.action === "Build monetization plan" && readyTitles.some(t=>t.includes("build monetization plan"))) ||
        (ai.action === "Prepare outreach pack" && readyTitles.some(t=>t.includes("prepare outreach pack"))) ||
        (ai.action === "Send approved outreach" && readyTitles.some(t=>t.includes("send approved outreach")) &&
          liveApprovals.some((a:any)=>a?.status==="APPROVED" && String(a?.title||"").toLowerCase().includes("approve sending outreach"))) ||
        (ai.action === "Learn from business result" && readyTitles.some(t=>t.includes("learn from business result"))) ||
        ai.action === "Review ledger for new work";

      if (validForLedger) {
        const matchingTask = liveTasks.find((t:any)=>{
          const title=String(t?.title||"").toLowerCase();
          if(String(t?.status||"")!=="READY") return false;
          if(ai.action==="Build monetization plan") return title.includes("build monetization plan");
          if(ai.action==="Prepare outreach pack") return title.includes("prepare outreach pack");
          if(ai.action==="Send approved outreach") return title.includes("send approved outreach");
          if(ai.action==="Learn from business result") return title.includes("learn from business result");
          return false;
        });
        const safeAction = matchingTask
          ? {...ai, opportunityId:String(matchingTask.opportunity_id||ai.opportunityId)}
          : ai;
        return NextResponse.json({ configured:true, brain:"AI", action:safeAction });
      }
    }

    return NextResponse.json({ configured:true, brain:"DETERMINISTIC", action:deterministic });
  } catch {
    return NextResponse.json({ configured:false, brain:"DETERMINISTIC", action:getNextAction(fallback) });
  }
}
