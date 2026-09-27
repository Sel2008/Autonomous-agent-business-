import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../lib/supabase";

type Candidate = {
  name: string;
  pursuitPriority: number;
  confidence: number;
  demandEvidence: string;
  accessEvidence: string;
  economicsEvidence: string;
  repeatabilityEvidence: string;
  riskEvidence: string;
  risks: string[];
  nextValidation: string;
};

const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    candidates: { type: "array", items: { type: "object", properties: {
      name: { type: "string" },
      pursuitPriority: { type: "number" },
      confidence: { type: "number" },
      demandEvidence: { type: "string" },
      accessEvidence: { type: "string" },
      economicsEvidence: { type: "string" },
      repeatabilityEvidence: { type: "string" },
      riskEvidence: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      nextValidation: { type: "string" }
    }, required: ["name","pursuitPriority","confidence","demandEvidence","accessEvidence","economicsEvidence","repeatabilityEvidence","riskEvidence","risks","nextValidation"] } }
  }, required: ["summary","candidates"]
};

function normalizeScore(value: unknown): number {
  const n = Number(value); if (!Number.isFinite(n)) return 0;
  const scaled = n >= 0 && n <= 1 ? n * 100 : n;
  return Math.round(Math.max(0, Math.min(100, scaled)));
}

function extractSourceUrls(candidate: Candidate): string[] {
  const fields = [
    candidate.demandEvidence,
    candidate.accessEvidence,
    candidate.economicsEvidence,
    candidate.repeatabilityEvidence,
    candidate.riskEvidence
  ];
  const urls = fields.flatMap((field) => String(field || "").match(/https?:\/\/[^\s)\],]+/g) || []);
  return Array.from(new Set(urls));
}

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ configured:false, runs:[] });
  try {
    const [runs, candidates] = await Promise.all([
      supabaseRequest("discovery_runs?select=*&order=created_at.desc&limit=10"),
      supabaseRequest("research_candidates?select=*&order=created_at.asc")
    ]);
    const candidateRows = Array.isArray(candidates) ? candidates : [];
    const grouped = (Array.isArray(runs) ? runs : []).map((run:any) => ({ ...run, candidates: candidateRows.filter((candidate:any) => candidate.run_id === run.id) }));
    return NextResponse.json({ configured:true, runs:grouped });
  } catch (error) {
    return NextResponse.json({ configured:false, runs:[], error:error instanceof Error ? error.message : "Discovery history read failed" }, { status:500 });
  }
}

export async function POST(req: Request) {
  const key = process.env.EXA_API_KEY;
  if (!key) return NextResponse.json({ ok:false, configured:false, error:"Research provider is not configured in the app. A server-side EXA_API_KEY is required for deployed research." }, { status:503 });
  try {
    let body:any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok:false, configured:true, error:"The dashboard sent an invalid or empty JSON request body." }, { status:400 });
    }
    const goal = String(body?.goal || "").trim();
    const marketScope = String(body.marketScope || "Global").trim();
    if (!goal) return NextResponse.json({ ok:false, error:"A research goal is required." }, { status:400 });

    const prompt = `Research goal: ${goal}\nMarket scope: ${marketScope}\n\nThis is a RESEARCH-ONLY test. Do not recommend contacting anyone, spending money, creating accounts, making commitments, or taking irreversible actions.\n\nFind concrete business or service opportunities that fit the goal. For every candidate, investigate FIVE separate dimensions: (1) demand, (2) customer access, (3) economics/monetization, (4) repeatability, and (5) risks/competition/compliance. For each dimension, clearly separate sourced evidence from inference and state when evidence is weak, conflicting, indirect, or missing.\n\nSet pursuitPriority from 0-100 using only the strength and completeness of the evidence across those five dimensions. Set confidence from 0-100 based on source quality, independence/corroboration, recency where relevant, and how much of the assessment is actually evidenced. Do not use arbitrary low scores just because this is an early test. Do not treat the priority score as a prediction of business success.\n\nList concrete risks separately and give exactly one nextValidation step that would most efficiently resolve the biggest remaining uncertainty. Put the URLs of the sources you relied on inside the relevant evidence text (for example, "Source: https://..."), because the response schema is intentionally limited. Do not invent sources. The result should help an owner decide what deserves further investigation, while preserving uncertainty rather than hiding it.`;

    const response = await fetch("https://api.exa.ai/search", {
      method:"POST", headers:{ "x-api-key":key, "Content-Type":"application/json" },
      body:JSON.stringify({ query:prompt, type:"deep", outputSchema, numResults:10 }), cache:"no-store"
    });

    // Exa can return an empty/non-JSON body on an upstream failure. Read text first
    // so the app reports the real upstream status instead of throwing JSON.parse errors.
    const raw = await response.text();
    let data:any = null;
    if (raw.trim()) { try { data = JSON.parse(raw); } catch { data = { raw }; } }
    if (!response.ok) {
      const detail = data?.error || data?.message || data?.raw || `Exa request failed: ${response.status}`;
      return NextResponse.json({ ok:false, configured:true, error:String(detail) }, { status:502 });
    }
    if (!data) return NextResponse.json({ ok:false, configured:true, error:"Exa returned an empty response." }, { status:502 });

    const output = data?.output?.content ?? data?.output ?? data?.answer ?? data;
    let parsed:any = output;
    if (typeof output === "string") {
      try { parsed = JSON.parse(output); }
      catch { return NextResponse.json({ ok:false, configured:true, error:"Exa returned research content that was not valid JSON." }, { status:502 }); }
    }
    const summary = parsed?.summary || "";
    const candidates: Candidate[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    let runId:string | null = null;

    if (supabaseConfigured()) {
      const created = await supabaseRequest("discovery_runs", { method:"POST", body:JSON.stringify({ goal, market_scope:marketScope, mode:"RESEARCH_ONLY", status:"RUNNING", summary:"" }), headers:{"Prefer":"return=representation"} });
      runId = created?.[0]?.id || null;
      if (!runId) throw new Error("Discovery run could not be recorded.");
      try {
        if (candidates.length > 0) {
          const rows = candidates.map((candidate) => ({
            run_id:runId, name:String(candidate.name || "Unnamed opportunity"), opportunity_type:"", market:marketScope,
            rationale:String(candidate.demandEvidence || ""),
            pursuit_priority:normalizeScore(candidate.pursuitPriority),
            confidence:normalizeScore(candidate.confidence),
            demand_evidence:String(candidate.demandEvidence || ""),
            access_evidence:String(candidate.accessEvidence || ""),
            economics_evidence:String(candidate.economicsEvidence || ""),
            repeatability_evidence:String(candidate.repeatabilityEvidence || ""),
            risk_evidence:String(candidate.riskEvidence || ""),
            risks:Array.isArray(candidate.risks) ? candidate.risks.map(String) : [],
            next_validation:String(candidate.nextValidation || ""),
            source_urls:extractSourceUrls(candidate)
          }));
          await supabaseRequest("research_candidates", { method:"POST", body:JSON.stringify(rows), headers:{"Prefer":"return=minimal"} });
        }
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), { method:"PATCH", body:JSON.stringify({ status:"COMPLETE", summary:String(summary), completed_at:new Date().toISOString() }), headers:{"Prefer":"return=minimal"} });
      } catch (persistError) {
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), { method:"PATCH", body:JSON.stringify({ status:"FAILED", summary:"Research completed, but persistence failed before the run could be fully recorded." }), headers:{"Prefer":"return=minimal"} }).catch(() => {});
        throw persistError;
      }
    }
    return NextResponse.json({ ok:true, configured:true, goal, marketScope, researchOnly:true, runId, persisted:Boolean(runId), summary, candidates, grounding:data?.output?.grounding || data?.grounding || [] });
  } catch (error) {
    return NextResponse.json({ ok:false, error:error instanceof Error ? error.message : "Discovery request failed" }, { status:500 });
  }
}
