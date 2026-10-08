import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../lib/supabase";

const opportunities = [
  { id:"lead-research", name:"AI-assisted local-business lead research", model:"Service", capital:"R0 to start", status:"RESEARCH", why:"Find public business prospects, identify obvious gaps, prepare personalized outreach drafts, and let the owner approve/send them.", next_action:"Build a verified lead record before outreach." },
  { id:"micro-service", name:"Repeatable micro-service delivery", model:"Service", capital:"R0 to start", status:"CANDIDATE", why:"Package research, data cleanup, listing optimization or simple content preparation into a deliverable that can be sold after validation.", next_action:"Choose one narrowly defined deliverable and create a sample workflow." },
  { id:"online-tasks", name:"Legitimate online task opportunities", model:"Tasks", capital:"R0 to start", status:"PHASE 1", why:"Use verification, scoring, payout and net-earnings tracking before spending meaningful time on any task.", next_action:"Verify current opportunities before execution." },
  { id:"pod-store", name:"Store / POD module", model:"Product", capital:"Later", status:"ROADMAP", why:"The original Store/POD plan remains intact and can be activated when research, economics and owner approval justify it.", next_action:"Keep separate; no publishing or spending without approval." }
];

const tasks = [
  { id:"t1", title:"Verify the first zero-capital business workflow", status:"READY", opportunity_id:"lead-research" },
  { id:"t2", title:"Define evidence for opportunity verification", status:"READY", opportunity_id:"lead-research" },
  { id:"t3", title:"Select the first micro-service to prototype", status:"READY", opportunity_id:"micro-service" }
];

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ configured:false, opportunities, tasks, approvals:[], evidence:[], verification:{} });
  try {
    const [o,t,a,e,v] = await Promise.all([
      supabaseRequest("opportunities?select=*&order=created_at.desc"),
      supabaseRequest("tasks?select=*&order=created_at.desc"),
      supabaseRequest("approvals?select=*&order=created_at.desc"),
      supabaseRequest("evidence?select=*&order=created_at.desc"),
      supabaseRequest("opportunity_verification?select=*")
    ]);

    // The dashboard is the live research view. Keep the original bootstrap
    // tasks/opportunities in the database for history, but do not mix them with
    // newly researched candidates in the operator-facing board.
    const opportunityRows = Array.isArray(o) ? o : [];
    const liveOpportunities = opportunityRows.filter((row:any) => String(row?.id || "").startsWith("research-"));
    const liveIds = new Set(liveOpportunities.map((row:any) => String(row.id)));
    const liveTasks = (Array.isArray(t) ? t : []).filter((row:any) => liveIds.has(String(row?.opportunity_id || "")) && String(row?.id || "").startsWith("research-"));
    const liveEvidence = (Array.isArray(e) ? e : []).filter((row:any) => liveIds.has(String(row?.opportunity_id || "")));
    const liveVerification = (Array.isArray(v) ? v : []).filter((row:any) => liveIds.has(String(row?.opportunity_id || "")));

    return NextResponse.json({
      configured:true,
      opportunities:liveOpportunities,
      tasks:liveTasks,
      approvals:Array.isArray(a) ? a : [],
      evidence:liveEvidence,
      verification:liveVerification
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database read error";
    console.error("Supabase ledger GET failed:", message);
    return NextResponse.json({ configured:false, db_error:message, opportunities, tasks, approvals:[], evidence:[], verification:{} });
  }
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ ok:false, configured:false }, { status:503 });
  try {
    const body = await req.json();
    const { action, payload } = body;
    let result:any = null;
    if (action === "task") {
      result = await supabaseRequest("tasks?id=eq."+encodeURIComponent(payload.id), { method:"PATCH", body:JSON.stringify({status:payload.status}) });
    } else if (action === "approval-create") {
      result = await supabaseRequest("approvals", { method:"POST", body:JSON.stringify(payload) });
    } else if (action === "approval-decide") {
      result = await supabaseRequest("approvals?id=eq."+encodeURIComponent(payload.id), { method:"PATCH", body:JSON.stringify({status:payload.status, decided_at:new Date().toISOString()}) });
      if (payload.status === "REJECTED" && payload.opportunityId) {
        await supabaseRequest("opportunities?id=eq."+encodeURIComponent(payload.opportunityId), { method:"PATCH", body:JSON.stringify({status:"REJECTED", next_action:"Owner rejected this monetization test; the agent should move to the next eligible zero-capital opportunity."}), headers:{"Prefer":"return=minimal"} });
        const rejectedTasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(payload.opportunityId)+"&status=eq.READY&select=*");
        if(Array.isArray(rejectedTasks)) for(const task of rejectedTasks){
          if(String(task?.title||"").toLowerCase().includes("outreach") && task?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(String(task.id)),{method:"PATCH",body:JSON.stringify({status:"BLOCKED"}),headers:{"Prefer":"return=minimal"}});
        }
      }
    } else if (action === "evidence-create") {
      result = await supabaseRequest("evidence", { method:"POST", body:JSON.stringify(payload) });
    } else if (action === "evidence-quality") {
      result = await supabaseRequest("evidence?id=eq."+encodeURIComponent(payload.id), { method:"PATCH", body:JSON.stringify({quality:payload.quality}) });
    } else if (action === "verification") {
      result = await supabaseRequest("opportunity_verification?opportunity_id=eq."+encodeURIComponent(payload.opportunity_id), { method:"POST", body:JSON.stringify(payload), headers:{"Prefer":"resolution=merge-duplicates,return=representation"} });
    } else {
      return NextResponse.json({ error:"Unknown action" }, { status:400 });
    }
    return NextResponse.json({ ok:true, result });
  } catch (error) {
    return NextResponse.json({ ok:false, error:error instanceof Error ? error.message : "Database error" }, { status:500 });
  }
}
