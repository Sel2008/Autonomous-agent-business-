import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

type Dimension = "demand" | "access" | "margin" | "repeatability" | "risk";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok:false, error:"Agent worker is not authorized. Configure CRON_SECRET." }, { status:401 });
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ ok:false, error:"Supabase is not configured." }, { status:503 });
  }

  try {
    const origin = new URL(req.url).origin;
    const nextResponse = await fetch(`${origin}/api/agent/next-action`, { cache:"no-store" });
    const next = await nextResponse.json().catch(() => ({}));

    if (next?.action && next?.status === "READY" && next?.opportunityId) {
      const match = /^Verify (demand|access|margin|repeatability|risk)$/.exec(String(next.action));
      if (match) {
        const dimension = match[1] as Dimension;
        const validation = await fetch(`${origin}/api/agent/validate`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ opportunityId:next.opportunityId, dimension }),
          cache:"no-store"
        });
        const result = await validation.json().catch(() => ({}));
        return NextResponse.json({
          ok: validation.ok && result.ok !== false,
          worker:"agent-heartbeat",
          action:next.action,
          opportunityId:next.opportunityId,
          dimension,
          result
        }, { status: validation.ok ? 200 : validation.status || 502 });
      }
    }

    return NextResponse.json({
      ok:true,
      worker:"agent-heartbeat",
      action:next?.action || null,
      status:next?.status || null,
      message:"No safe validation action was ready for this heartbeat."
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
