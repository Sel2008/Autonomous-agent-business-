import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

type Dimension = "demand" | "access" | "margin" | "repeatability" | "risk";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function updateActiveRun(summary:string, status?:string) {
  if (!supabaseConfigured()) return;
  const rows = await supabaseRequest(
    "discovery_runs?mode=eq.OWNER_APPROVAL_EXECUTION&order=created_at.desc&limit=1&select=id,status"
  ).catch(()=>[]);
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.id) return;
  await supabaseRequest("discovery_runs?id=eq." + encodeURIComponent(String(run.id)), {
    method:"PATCH",
    body:JSON.stringify({
      ...(status ? {status} : {}),
      summary,
      ...(status==="COMPLETE" || status==="FAILED" ? {completed_at:new Date().toISOString()} : {})
    }),
    headers:{"Prefer":"return=minimal"}
  }).catch(()=>{});
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

  if (action === "Learn from business result") {
    const response = await fetch(`${origin}/api/agent/learn`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId}),
      cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    return { response, result, type:"learning" };
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
      await updateActiveRun("Agent paused: owner approval is required before the next consequential step.","PENDING");
      return NextResponse.json({
        ok:true,
        worker:"agent-heartbeat",
        action,
        status:"WAITING",
        message:"Owner approval is blocking the next consequential step."
      });
    }

    if (action && opportunityId && actionObject?.status === "READY") {
      await updateActiveRun("Agent is working: " + action + (opportunityId && opportunityId!=="system" ? " · " + opportunityId : ""),"RUNNING");
      const executed = await runAction(origin, action, opportunityId);
      if (executed) {
        const ok = executed.response.ok && executed.result?.ok !== false;
        if (!ok) {
          await updateActiveRun("Agent step failed: " + String(executed.result?.error || "Safe agent step failed."),"FAILED");
        } else {
          await updateActiveRun("Agent completed: " + action + ". Continuing on the next worker heartbeat…","RUNNING");
        }
        return NextResponse.json({
          ok,
          worker:"agent-heartbeat",
          action,
          opportunityId,
          type:executed.type,
          result:executed.result
        }, { status:executed.response.ok ? 200 : executed.response.status || 502 });
      }
    }

    await updateActiveRun("Agent reached a stable state: " + (action || "No safe action currently ready") + ".","COMPLETE");
    return NextResponse.json({
      ok:true,
      worker:"agent-heartbeat",
      action:action || null,
      status:actionObject?.status || null,
      message:"No autonomous safe action was ready for this heartbeat."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent heartbeat failed.";
    await updateActiveRun("Agent worker failed: " + message,"FAILED");
    return NextResponse.json({
      ok:false,
      worker:"agent-heartbeat",
      error:message
    }, { status:500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
