import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

type Dimension = "demand" | "access" | "margin" | "repeatability" | "risk";

function readableError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

const dimensionLabels: Record<Dimension, string> = {
  demand: "customer demand",
  access: "customer access",
  margin: "economics and margin",
  repeatability: "repeatability",
  risk: "competition, risk and compliance",
};

export async function POST(req: Request) {
  try {
    if (!supabaseConfigured()) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
    const key = process.env.EXA_API_KEY;
    if (!key) return NextResponse.json({ ok: false, error: "Research provider is not configured in the app." }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body?.opportunityId || "").trim();
    const dimension = String(body?.dimension || "").trim() as Dimension;
    if (!opportunityId || !(dimension in dimensionLabels)) {
      return NextResponse.json({ ok: false, error: "A valid opportunityId and verification dimension are required." }, { status: 400 });
    }

    const opportunities = await supabaseRequest("opportunities?id=eq." + encodeURIComponent(opportunityId) + "&select=*");
    const opportunity = Array.isArray(opportunities) ? opportunities[0] : null;
    if (!opportunity) return NextResponse.json({ ok: false, error: "Opportunity not found." }, { status: 404 });

    const label = dimensionLabels[dimension];
    const query = [
      "Verify " + label + ' for the business opportunity "' + String(opportunity.name || "") + '".',
      "Business rationale: " + String(opportunity.why || ""),
      "Business model/context: " + String(opportunity.model || "") + ".",
      "This is a research-only verification step. Do not contact anyone, spend money, create accounts, make commitments, or take irreversible actions.",
      "Find concrete, current public evidence. Prefer independent, authoritative or primary sources where available. Distinguish sourced facts from inference.",
      "Return a concise verification finding, note uncertainty or conflicting evidence, and include the strongest source URLs.",
    ].join("\n");

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, type: "deep", numResults: 8 }),
      cache: "no-store",
    });

    const raw = await response.text();
    let data: any = null;
    if (raw.trim()) {
      try { data = JSON.parse(raw); } catch { data = { raw }; }
    }
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: readableError(data?.error || data?.message || data?.raw, "Verification research failed: " + response.status)
      }, { status: 502 });
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const sources = results
      .map((r: any) => ({ title: String(r?.title || r?.url || "Source"), url: String(r?.url || "").trim() }))
      .filter((s: { title: string; url: string }) => /^https?:\/\//.test(s.url));
    const uniqueSources = Array.from(new Map(sources.map((s: { title: string; url: string }) => [s.url, s])).values()).slice(0, 5);

    const finding = results.slice(0, 5).map((r: any) => {
      const title = String(r?.title || "Source");
      const text = String(r?.text || r?.snippet || r?.summary || "").replace(/\s+/g, " ").trim();
      return text ? title + ": " + text.slice(0, 700) : title;
    }).join("\n");

    const checkedOn = new Date().toISOString().slice(0, 10);
    const source = (uniqueSources[0] as { title: string; url: string } | undefined)?.url || "Exa verification run for " + String(opportunity.name || "opportunity");
    const notes = "Agent verification for " + label + ". Evidence found:\n" + finding +
      "\n\nSources: " + uniqueSources.map((s: { url: string }) => s.url).join(", ") +
      ".\n\nThis is evidence for further validation, not proof of business success.";

    const verificationRows = await supabaseRequest(
      "opportunity_verification?opportunity_id=eq." + encodeURIComponent(opportunityId) + "&select=*"
    );
    const verificationRow = Array.isArray(verificationRows) ? verificationRows[0] : null;

    if (verificationRow?.opportunity_id) {
      await supabaseRequest("opportunity_verification?opportunity_id=eq." + encodeURIComponent(opportunityId), {
        method: "PATCH",
        body: JSON.stringify({ [dimension]: "CHECKED" }),
        headers: { "Prefer": "return=minimal" },
      });
    } else {
      await supabaseRequest("opportunity_verification", {
        method: "POST",
        body: JSON.stringify({
          opportunity_id: opportunityId,
          demand: dimension === "demand" ? "CHECKED" : "UNVERIFIED",
          access: dimension === "access" ? "CHECKED" : "UNVERIFIED",
          margin: dimension === "margin" ? "CHECKED" : "UNVERIFIED",
          repeatability: dimension === "repeatability" ? "CHECKED" : "UNVERIFIED",
          risk: dimension === "risk" ? "CHECKED" : "UNVERIFIED",
        }),
        headers: { "Prefer": "return=minimal" },
      });
    }

    const persistedVerificationRows = await supabaseRequest(
      "opportunity_verification?opportunity_id=eq." + encodeURIComponent(opportunityId) + "&select=*"
    );
    const persistedRows = Array.isArray(persistedVerificationRows) ? persistedVerificationRows : [];
    const persisted = persistedRows.find((row: any) => String(row?.[dimension] || "") === "CHECKED" || String(row?.[dimension] || "") === "STRONG");
    if (!persisted) {
      throw new Error("Validation evidence was found, but the verification state did not persist in Supabase.");
    }

    const fullyVerified = ["demand", "access", "margin", "repeatability", "risk"].every(
      (key) => String(persisted?.[key] || "UNVERIFIED") === "CHECKED" || String(persisted?.[key] || "UNVERIFIED") === "STRONG"
    );

    await supabaseRequest("evidence", {
      method: "POST",
      body: JSON.stringify({
        opportunity_id: opportunityId,
        type: "VERIFICATION",
        claim: "Agent verified " + label,
        source,
        checked_on: checkedOn,
        quality: "CHECKED",
        notes,
      }),
      headers: { "Prefer": "return=minimal" },
    });

    const taskRows = await supabaseRequest(
      "tasks?opportunity_id=eq." + encodeURIComponent(opportunityId) + "&status=eq.READY&order=created_at.asc&select=*"
    );
    const validationTask = Array.isArray(taskRows)
      ? taskRows.find((row: any) => {
          const title = String(row?.title || "").toLowerCase();
          return title.includes("validate research candidate") || title.includes("verify " + dimension);
        })
      : null;

    if (validationTask?.id) {
      await supabaseRequest("tasks?id=eq." + encodeURIComponent(validationTask.id), {
        method: "PATCH",
        body: JSON.stringify({ status: "COMPLETE" }),
        headers: { "Prefer": "return=minimal" },
      });
    }

    // When all five dimensions are verified, create the next agent-owned
    // monetization step for this same opportunity. This prevents the agent
    // from abandoning a fully verified candidate while validating others.
    let monetizationTaskCreated = false;
    if (fullyVerified) {
      const allTasks = await supabaseRequest(
        "tasks?opportunity_id=eq." + encodeURIComponent(opportunityId) + "&select=*"
      );
      const hasMonetizationTask = Array.isArray(allTasks) && allTasks.some(
        (row: any) => /build monetization plan/i.test(String(row?.title || ""))
      );
      if (!hasMonetizationTask) {
        const taskId = "research-" + opportunityId.replace(/[^a-zA-Z0-9_-]/g, "-") + "-monetization";
        await supabaseRequest("tasks", {
          method: "POST",
          body: JSON.stringify({
            id: taskId,
            title: "Build monetization plan: " + String(opportunity.name || "opportunity"),
            status: "READY",
            opportunity_id: opportunityId
          }),
          headers: { "Prefer": "return=minimal" },
        });
        monetizationTaskCreated = true;
      }
    }

    return NextResponse.json({
      ok: true,
      opportunityId,
      dimension,
      status: "CHECKED",
      finding,
      sources: uniqueSources,
      taskCompleted: Boolean(validationTask?.id),
      fullyVerified,
      monetizationTaskCreated,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: readableError(error, "Agent verification failed.") }, { status: 500 });
  }
}
