import { NextResponse } from "next/server";
import { runBusinessAI } from "../../../../lib/ai-router";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

function deterministicMonetizationPlan(opportunity:any, state:any) {
  const name = String(opportunity?.name || "the selected opportunity").trim();
  const evidenceSummary = Object.entries(state || {})
    .map(([k,v]) => `${k}: ${String(v)}`)
    .join("; ");

  const lower = name.toLowerCase();
  let offer = `A small, productized first service for ${name}`;
  let customer = "A narrow customer segment that already has the stated problem and can make a small purchasing decision.";
  let problem = `Reduce the customer's most immediate problem related to ${name} without requiring a long contract.`;
  let deliverable = "One clearly defined starter deliverable with a fixed scope and a short turnaround.";
  let pricing = "Start with a small fixed-price pilot; validate willingness to pay before increasing scope or price.";
  let acquisition = "Build a small prospect list from public business websites/directories and prepare personalized outreach for owner approval.";
  let firstPaidTest = "Offer the fixed-scope pilot to a small number of qualified prospects; do not send or commit to outreach until owner approval is granted.";
  let expectedCosts = "R0 cash target for the first test: use existing free tools and customer-provided assets where possible. Reassess any unavoidable paid cost before spending.";
  let risks = "Demand, access, delivery time, pricing and competition remain hypotheses until a real prospect responds or pays. Do not claim revenue before payment.";
  let successMetric = "At least one qualified prospect agrees to the paid pilot at the proposed price, with delivery effort and margin recorded.";

  if (lower.includes("short-form") || lower.includes("video")) {
    offer = "A fixed-scope short-form video starter pack for a local SMB: a small batch of edited vertical clips from customer-provided footage.";
    customer = "Local SMBs that already have phone footage or existing content but need consistent short-form social content.";
    problem = "Turn existing business footage into usable short-form social content without requiring the business to learn editing.";
    deliverable = "A small fixed batch of vertical clips with captions/hooks, delivered in a defined turnaround using customer-provided assets.";
    pricing = "Test one fixed-price starter package first; use a low-friction pilot price and raise it only after validating demand and delivery time.";
    acquisition = "Find local businesses with active social pages/websites and visible content gaps; prepare a short personalized offer for owner approval.";
    firstPaidTest = "Secure one paid pilot before building a larger service; use the customer's existing footage so the initial cash requirement stays near zero.";
  } else if (lower.includes("virtual assistant") || lower.includes("admin")) {
    offer = "A fixed-scope remote admin starter package covering one repetitive business task.";
    customer = "Small businesses with a recurring administrative task that can be clearly scoped.";
    problem = "Remove a defined repetitive admin task without requiring a long-term hire.";
    deliverable = "One documented admin workflow completed for a fixed scope and turnaround.";
    pricing = "Test a fixed-price starter task before offering a recurring package.";
  } else if (lower.includes("bookkeeping")) {
    offer = "A narrowly scoped bookkeeping cleanup or reporting starter service, subject to appropriate local compliance and qualification requirements.";
    customer = "Small businesses needing a clearly defined bookkeeping task rather than full-service accounting.";
    problem = "Resolve one specific bookkeeping backlog or reporting need.";
    deliverable = "One agreed bookkeeping cleanup/reporting deliverable with documented inputs and outputs.";
    pricing = "Use a fixed-price pilot tied to the exact scope; do not price regulated work without confirming qualifications and local requirements.";
    risks = "Qualification, tax/accounting compliance, data privacy and accuracy are material risks; confirm requirements before offering regulated services.";
  } else if (lower.includes("ai") || lower.includes("automation")) {
    offer = "A small fixed-scope workflow automation audit/prototype for one repetitive business process.";
    customer = "Small businesses with a repetitive workflow that can be tested without changing critical systems.";
    problem = "Reduce manual work in one narrowly defined workflow.";
    deliverable = "One workflow map plus a small prototype or implementation plan using available tools.";
    pricing = "Test a fixed-price discovery/prototype before proposing a larger implementation.";
    risks = "Integration reliability, data privacy, access permissions and unclear ROI are key risks; test on non-critical workflows first.";
  }

  return {
    offer, idealCustomer:customer, problemSolved:problem, deliverable, pricing,
    acquisition, firstPaidTest, expectedCosts, risks, successMetric,
    planningMode:"DETERMINISTIC_FALLBACK",
    verificationSnapshot:evidenceSummary
  };
}

function errorText(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  try { return value ? JSON.stringify(value) : fallback; } catch { return fallback; }
}

export async function POST(req: Request) {
  try {
    if (!supabaseConfigured()) return NextResponse.json({ ok:false, error:"Supabase is not configured." }, { status:503 });

    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body?.opportunityId || "").trim();
    if (!opportunityId) return NextResponse.json({ ok:false, error:"opportunityId is required." }, { status:400 });

    const [opportunities, verification] = await Promise.all([
      supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*"),
      supabaseRequest("opportunity_verification?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&select=*")
    ]);
    const opportunity = Array.isArray(opportunities) ? opportunities[0] : null;
    if (!opportunity) return NextResponse.json({ ok:false, error:"Opportunity not found." }, { status:404 });

    const dimensions = Array.isArray(verification) ? verification : [];
    const state = dimensions.reduce((acc:any,row:any)=>{
      for (const k of ["demand","access","margin","repeatability","risk"]) {
        const v=String(row?.[k]||"UNVERIFIED");
        if ((acc[k]||"UNVERIFIED")==="UNVERIFIED" || v==="STRONG") acc[k]=v;
        else if (v==="CHECKED") acc[k]="CHECKED";
      }
      return acc;
    }, {demand:"UNVERIFIED",access:"UNVERIFIED",margin:"UNVERIFIED",repeatability:"UNVERIFIED",risk:"UNVERIFIED"});

    const schema={type:"object",additionalProperties:false,properties:{
      offer:{type:"string"},idealCustomer:{type:"string"},problemSolved:{type:"string"},deliverable:{type:"string"},
      pricing:{type:"string"},acquisition:{type:"string"},firstPaidTest:{type:"string"},expectedCosts:{type:"string"},
      risks:{type:"string"},successMetric:{type:"string"}
    },required:["offer","idealCustomer","problemSolved","deliverable","pricing","acquisition","firstPaidTest","expectedCosts","risks","successMetric"]};
    const prompt=[
      "Create a realistic first paid test from the validated business opportunity.",
      "Do not invent evidence or promise revenue. Keep the test zero or low cash.",
      "Return one concrete offer, customer, problem, deliverable, pricing hypothesis, acquisition method, first paid test, costs, risks, and success metric.",
      "OPPORTUNITY:",JSON.stringify(opportunity),"VERIFICATION:",JSON.stringify(state)
    ].join("\n");

    const result=await runBusinessAI({prompt,schema});
    let plan:any;
    let planningMode = "AI";
    let provider = "UNKNOWN";
    if (result) {
      try { plan=JSON.parse(result.text); provider=result.provider; }
      catch { plan=null; }
    }
    if (!plan) {
      plan = deterministicMonetizationPlan(opportunity, state);
      planningMode = "DETERMINISTIC_FALLBACK";
      provider = "DETERMINISTIC";
    }

    const notes=Object.entries(plan).map(([k,v])=>k+": "+String(v)).join("\n");
    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"MONETIZATION_PLAN",
        claim:"Agent-created first paid test plan for "+String(opportunity.name||"opportunity"),
        source:planningMode==="AI" ? "Central business brain ("+provider+")" : "Deterministic monetization planner (AI unavailable)",
        checked_on:new Date().toISOString().slice(0,10),
        quality:"CHECKED",
        notes
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const tasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&status=eq.READY&select=*");
    const planTask=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("build monetization plan")):null;
    if(planTask?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(planTask.id),{
      method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
    });

    const taskId="research-"+opportunityId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-outreach";
    const existing=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.id||"")===taskId):null;
    if(!existing) {
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({id:taskId,title:"Prepare outreach pack: "+String(opportunity.name||"opportunity"),status:"READY",opportunity_id:opportunityId}),
        headers:{"Prefer":"return=minimal"}
      });
    }

    const approvalId="approval-"+taskId;
    const approvals=await supabaseRequest("approvals?id=eq."+encodeURIComponent(approvalId)+"&select=*");
    if(!Array.isArray(approvals)||approvals.length===0) {
      await supabaseRequest("approvals",{
        method:"POST",
        body:JSON.stringify({
          id:approvalId,
          title:"Approve monetization test: "+String(opportunity.name||"opportunity"),
          tier:"T1",
          status:"PENDING"
        }),
        headers:{"Prefer":"return=minimal"}
      });
    }

    return NextResponse.json({ok:true,opportunityId,plan,planningMode,provider,approvalId,nextTask:taskId});
  } catch(error) {
    return NextResponse.json({ok:false,error:errorText(error,"Monetization planning failed.")},{status:500});
  }
}
