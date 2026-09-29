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
    const oidcToken = await getVercelOidcToken().catch(() => null);
    const ownerCookie = req.headers.get("cookie");
    const internalHeaders: HeadersInit = { "Content-Type": "application/json" };
    if (ownerCookie) internalHeaders["cookie"] = ownerCookie;
    if (oidcToken) internalHeaders["x-vercel-trusted-oidc-idp-token"] = oidcToken;

    const discovery = await fetch(`${origin}/api/discovery`, {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ goal, marketScope }),
      cache: "no-store",
    });

    const result = await discovery.json().catch(() => ({}));
    if (!discovery.ok || !result.ok) {
      return NextResponse.json({
        ok: false,
        stage: "RESEARCH",
        error: readableError(result?.error, "The agent could not complete its research stage."),
      }, { status: discovery.status || 502 });
    }

    const nextHeaders: HeadersInit = {};
    if (ownerCookie) nextHeaders["cookie"] = ownerCookie;
    if (oidcToken) nextHeaders["x-vercel-trusted-oidc-idp-token"] = oidcToken;

    const next = await fetch(`${origin}/api/agent/next-action`, {
      headers: nextHeaders,
      cache: "no-store"
    });
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
      error: readableError(error, "Agent run failed"),
    }, { status: 500 });
  }
}
