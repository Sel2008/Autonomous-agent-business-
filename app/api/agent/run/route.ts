import { NextResponse, after } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

function readableError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

async function updateRun(runId:string, summary:string, status?:string) {
  if (!supabaseConfigured() || !runId) return;
  await supabaseRequest(`discovery_runs?id=eq.${encodeURIComponent(runId)}`, {
    method:"PATCH",
    body:JSON.stringify({
      ...(status ? {status} : {}),
      summary,
      ...(status==="COMPLETE" || status==="FAILED" ? {completed_at:new Date().toISOString()} : {})
    }),
    headers:{"Prefer":"return=minimal"}
  }).catch(()=>{});
}

async function executeSafeFollowUp(origin:string, headers:HeadersInit, action:any) {
  const actionName=String(action?.action||"");
  const opportunityId=String(action?.opportunityId||"");
  if(!opportunityId || action?.status!=="READY") return null;

  if(/^Verify (demand|access|margin|repeatability|risk)$/.test(actionName)){
    const dimension=actionName.replace(/^Verify /,"").toLowerCase();
    const response=await fetch(`${origin}/api/agent/validate`,{
      method:"POST",headers,
      body:JSON.stringify({opportunityId,dimension}),cache:"no-store"
    });
    return {response,result:await response.json().catch(()=>({}))};
  }

  if(actionName==="Build monetization plan"){
    const response=await fetch(`${origin}/api/agent/monetize`,{
      method:"POST",headers,
      body:JSON.stringify({opportunityId}),cache:"no-store"
    });
    return {response,result:await response.json().catch(()=>({}))};
  }

  if(actionName==="Prepare outreach pack"){
    const response=await fetch(`${origin}/api/agent/outreach`,{
      method:"POST",headers,
      body:JSON.stringify({opportunityId}),cache:"no-store"
    });
    return {response,result:await response.json().catch(()=>({}))};
  }

  return null;
}

async function processAgentRun(origin:string, headers:HeadersInit, runId:string, goal:string, marketScope:string) {
  try {
    await updateRun(runId,"Agent started. Researching the mission…","RUNNING");

    const discovery=await fetch(`${origin}/api/discovery`,{
      method:"POST",
      headers,
      body:JSON.stringify({goal,marketScope,existingRunId:runId}),
      cache:"no-store"
    });
    const result:any=await discovery.json().catch(()=>({}));

    if(!discovery.ok || !result.ok){
      await updateRun(runId,`Research failed: ${readableError(result?.error,"The agent could not complete research.")}`,"FAILED");
      return;
    }

    await updateRun(runId,`Research complete. ${Array.isArray(result.promotedOpportunities) ? result.promotedOpportunities.length : 0} opportunities entered the live ledger. Starting verification…`,"RUNNING");

    let autonomousSteps=0;
    let next=await fetch(`${origin}/api/agent/next-action`,{headers,cache:"no-store"});
    let nextResult=await next.json().catch(()=>({}));

    while (autonomousSteps < 30) {
      const action=nextResult?.action;
      if (!action || action.status !== "READY") {
        if (action?.status==="WAITING" || action?.permission==="OWNER_APPROVAL_REQUIRED") {
          await updateRun(runId,`Agent paused: ${String(action.action||"Owner approval required")} — waiting for your decision.`,"WAITING_APPROVAL");
        } else {
          await updateRun(runId,`Agent reached a stable state: ${String(action?.action||"No safe action currently ready")}.`, "COMPLETE");
        }
        return;
      }

      const actionName=String(action.action||"");
      if(action.permission==="OWNER_APPROVAL_REQUIRED" || actionName==="Wait for owner approval" || /^Send approved outreach/i.test(actionName)){
        await updateRun(runId,`Agent paused: ${actionName}. Owner approval is required before the next consequential step.`,"WAITING_APPROVAL");
        return;
      }

      if(actionName==="Select verified opportunity for monetization"){
        await updateRun(runId,"All current opportunities are verified. The business brain is comparing the evidence and selecting one for monetization…","RUNNING");
        const refreshed=await fetch(`${origin}/api/agent/next-action`,{headers,cache:"no-store"});
        nextResult=await refreshed.json().catch(()=>nextResult);
        continue;
      }

      await updateRun(runId,`Agent is working: ${actionName}${action.opportunityId && action.opportunityId!=="system" ? " · "+action.opportunityId : ""}`,"RUNNING");

      const followUp=await executeSafeFollowUp(origin,headers,action);
      if(!followUp){
        await updateRun(runId,`Agent stopped safely at: ${actionName}.`,"COMPLETE");
        return;
      }

      autonomousSteps += 1;
      if(!followUp.response.ok || followUp.result?.ok===false){
        await updateRun(runId,`Agent step failed: ${readableError(followUp.result?.error,"Safe agent step failed.")}`,"FAILED");
        return;
      }

      const refreshed=await fetch(`${origin}/api/agent/next-action`,{headers,cache:"no-store"});
      nextResult=await refreshed.json().catch(()=>nextResult);
    }

    await updateRun(runId,"Agent reached its safe-step checkpoint and will not perform further work without another controlled worker invocation.","COMPLETE");
  } catch(error) {
    await updateRun(runId,`Agent run failed: ${readableError(error,"Agent run failed.")}`,"FAILED");
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const goal = String(body?.goal || "").trim();
    const marketScope = String(body?.marketScope || "Global").trim();
    if (!goal) return NextResponse.json({ ok:false, error:"A mission is required." }, { status:400 });

    const origin = new URL(req.url).origin;
    const oidcToken = await getVercelOidcToken().catch(() => null);
    const ownerCookie = req.headers.get("cookie");
    const internalHeaders: HeadersInit = { "Content-Type":"application/json" };
    if(ownerCookie) internalHeaders["cookie"]=ownerCookie;
    if(oidcToken) internalHeaders["x-vercel-trusted-oidc-idp-token"]=oidcToken;

    if(!supabaseConfigured()){
      return NextResponse.json({ok:false,error:"The live database is required for a page-independent agent run."},{status:503});
    }

    const created=await supabaseRequest("discovery_runs",{
      method:"POST",
      body:JSON.stringify({
        goal,
        market_scope:marketScope,
        mode:"AGENT_RUN",
        status:"QUEUED",
        summary:"Agent run queued…"
      }),
      headers:{"Prefer":"return=representation"}
    });
    const runId=created?.[0]?.id;
    if(!runId) throw new Error("Agent run could not be recorded.");

    // The browser receives the run id immediately. The agent work belongs to the
    // server invocation, not to the Research page that started it.
    after(()=>processAgentRun(origin,internalHeaders,runId,goal,marketScope));

    return NextResponse.json({
      ok:true,
      run:{
        runId,
        researchRunId:runId,
        goal,
        marketScope,
        stage:"QUEUED",
        autonomousSteps:0
      },
      action:{
        opportunityId:"system",
        action:"Agent run started",
        reason:"The agent is now working independently of the current page. You can leave and return to the dashboard.",
        permission:"READ_ONLY",
        status:"IN_PROGRESS"
      }
    });
  } catch(error) {
    return NextResponse.json({ok:false,error:readableError(error,"Agent run could not be started.")},{status:500});
  }
}
