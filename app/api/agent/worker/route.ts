import { NextResponse } from "next/server";

type Dimension = "demand" | "access" | "margin" | "repeatability" | "risk";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function runAction(origin:string, action:string, opportunityId:string) {
  if (/^Verify (demand|access|margin|repeatability|risk)$/.test(action)) {
    const dimension = action.replace(/^Verify /,"").toLowerCase() as Dimension;
    const response = await fetch(`${origin}/api/agent/validate`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId,dimension}),
      cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    return { response, result, type:"validation", dimension };
  }

  if (action === "Build monetization plan") {
    const response = await fetch(`${origin}/api/agent/monetize`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId}),
      cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    return { response, result, type:"monetization" };
  }

  if (action === "Prepare outreach pack") {
    const response = await fetch(`${origin}/api/agent/outreach`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId}),
      cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    return { response, result, type:"outreach" };
  }

  if (action === "Send approved outreach") {
    const response = await fetch(`${origin}/api/agent/send-outreach`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId}),
      cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    return { response, result, type:"send-outreach" };
  }

  return null;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok:false, error:"Agent worker is not authorized. Configure CRON_SECRET." }, { status:401 });
  }

  try {
    const origin = new URL(req.url).origin;
    const nextResponse = await fetch(`${origin}/api/agent/next-action`, { cache:"no-store" });
    const next = await nextResponse.json().catch(()=>({}));
    const actionObject = next?.action || {};
    const action = String(actionObject?.action || "");
    const opportunityId = String(actionObject?.opportunityId || "");

    if (actionObject?.status === "WAITING") {
      return NextResponse.json({
        ok:true,
        worker:"agent-heartbeat",
        action,
        status:"WAITING",
        message:"Owner approval is blocking the next consequential step."
      });
    }

    if (action && opportunityId && actionObject?.status === "READY") {
      const executed = await runAction(origin, action, opportunityId);
      if (executed) {
        return NextResponse.json({
          ok:executed.response.ok && executed.result?.ok !== false,
          worker:"agent-heartbeat",
          action,
          opportunityId,
          type:executed.type,
          result:executed.result
        }, { status:executed.response.ok ? 200 : executed.response.status || 502 });
      }
    }

    return NextResponse.json({
      ok:true,
      worker:"agent-heartbeat",
      action:action || null,
      status:actionObject?.status || null,
      message:"No autonomous safe action was ready for this heartbeat."
    });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      worker:"agent-heartbeat",
      error:error instanceof Error ? error.message : "Agent heartbeat failed."
    }, { status:500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
