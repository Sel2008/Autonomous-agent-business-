import { NextResponse } from "next/server";

/**
 * Starts one supervised agent cycle from the owner's mission.
 * The owner supplies the mission; the agent decides that research is the
 * first internal step. Consequential execution is intentionally not included.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const goal = String(body?.goal || "").trim();
    const marketScope = String(body?.marketScope || "Global").trim();

    if (!goal) {
      return NextResponse.json({ ok: false, error: "A mission is required." }, { status: 400 });
    }

    const origin = new URL(req.url).origin;
    const discovery = await fetch(`${origin}/api/discovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, marketScope }),
      cache: "no-store",
    });

    const result = await discovery.json().catch(() => ({}));
    if (!discovery.ok || !result.ok) {
      return NextResponse.json({
        ok: false,
        stage: "RESEARCH",
        error: result?.error || "The agent could not complete its research stage.",
      }, { status: discovery.status || 502 });
    }

    const next = await fetch(`${origin}/api/agent/next-action`, { cache: "no-store" });
    const nextResult = await next.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      run: {
        goal,
        marketScope,
        stage: "RESEARCH_COMPLETE",
        researchRunId: result.runId || null,
        opportunitiesCreated: Array.isArray(result.promotedOpportunities) ? result.promotedOpportunities.length : 0,
      },
      action: nextResult?.action || null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Agent run failed",
    }, { status: 500 });
  }
}
