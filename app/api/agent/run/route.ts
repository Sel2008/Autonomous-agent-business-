import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

function readableError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const goal = String(body?.goal || "").trim();
    const marketScope = String(body?.marketScope || "Global").trim();
    if (!goal) return NextResponse.json({ ok: false, error: "A mission is required." }, { status: 400 });

    const origin = new URL(req.url).origin;
    const oidcToken = await getVercelOidcToken().catch(() => null);
    const ownerCookie = req.headers.get("cookie");
    const internalHeaders: HeadersInit = { "Content-Type": "application/json" };
    if (ownerCookie) internalHeaders["cookie"] = ownerCookie;
    if (oidcToken) internalHeaders["x-vercel-trusted-oidc-idp-token"] = oidcToken;

    let result:any = {};
    let autonomousSteps=0;
    let lastFollowUp:any=null;

    let next=await fetch(`${origin}/api/agent/next-action`,{headers:internalHeaders,cache:"no-store"});
    let nextResult=await next.json().catch(() => ({}));

    // If there is no existing safe work, start the requested research mission.
    if (nextResult?.action?.action === "Review ledger for new work") {
      const discovery=await fetch(`${origin}/api/discovery`,{
        method:"POST",
        headers:internalHeaders,
        body:JSON.stringify({goal,marketScope}),
        cache:"no-store"
      });
      result=await discovery.json().catch(()=>({}));
      if(!discovery.ok || !result.ok){
        return NextResponse.json({
          ok:false,stage:"RESEARCH",
          error:readableError(result?.error,"The agent could not complete its research stage.")
        },{status:discovery.status||502});
      }
      next=await fetch(`${origin}/api/agent/next-action`,{headers:internalHeaders,cache:"no-store"});
      nextResult=await next.json().catch(()=>({}));
    }

    // One Run can advance many safe internal steps. It stops at an owner
    // approval boundary or at the safety cap.
    while (autonomousSteps < 30) {
      const action=nextResult?.action;
      if (!action || action.status !== "READY") break;

      const actionName=String(action.action||"");
      if (
        action.permission === "OWNER_APPROVAL_REQUIRED" ||
        actionName === "Wait for owner approval" ||
        /^Send approved outreach/i.test(actionName)
      ) break;

      // This is a planning signal, not an executable action. Let the business
      // brain compare the fully verified opportunities and choose exactly one.
      if (actionName === "Select verified opportunity for monetization") {
        const refreshed=await fetch(`${origin}/api/agent/next-action`,{headers:internalHeaders,cache:"no-store"});
        nextResult=await refreshed.json().catch(()=>nextResult);
        continue;
      }

      const followUp=await executeSafeFollowUp(origin,internalHeaders,action);
      if (!followUp) break;

      lastFollowUp=followUp;
      autonomousSteps += 1;

      if (!followUp.response.ok || followUp.result?.ok===false) {
        return NextResponse.json({
          ok:false,
          stage:"AGENT_FOLLOW_UP",
          error:readableError(followUp.result?.error,"Safe agent step failed."),
          run:{
            goal,marketScope,
            stage:"AGENT_STEP_FAILED",
            researchRunId:result.runId||null,
            opportunitiesCreated:Array.isArray(result.promotedOpportunities)?result.promotedOpportunities.length:0,
            autonomousSteps
          },
          action:nextResult?.action||null
        },{status:followUp.response.status||502});
      }

      const refreshed=await fetch(`${origin}/api/agent/next-action`,{headers:internalHeaders,cache:"no-store"});
      nextResult=await refreshed.json().catch(()=>nextResult);
    }

    return NextResponse.json({
      ok:true,
      run:{
        goal,marketScope,
        stage:lastFollowUp?"AGENT_AUTONOMOUS_PROGRESS":result.runId?"RESEARCH_COMPLETE":"AGENT_NO_SAFE_WORK",
        researchRunId:result.runId||null,
        opportunitiesCreated:Array.isArray(result.promotedOpportunities)?result.promotedOpportunities.length:0,
        autonomousSteps
      },
      action:nextResult?.action||null,
      actionStatus:nextResult?.action?.status||null,
      brain:nextResult?.brain||"DETERMINISTIC"
    });
  } catch(error) {
    return NextResponse.json({ok:false,error:readableError(error,"Agent run failed")},{status:500});
  }
}
