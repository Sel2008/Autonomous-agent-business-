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
    candidates: { type: "array", items: { type: "object", properties: {
      name: { type: "string" },
      pursuitPriority: { type: "number" },
      confidence: { type: "number" },
      demandEvidence: { type: "string" },
      accessEvidence: { type: "string" },
      economicsEvidence: { type: "string" },
      repeatabilityEvidence: { type: "string" },
      riskEvidence: { type: "string" },
      nextValidation: { type: "string" }
    }, required: ["name","pursuitPriority","confidence","demandEvidence","accessEvidence","economicsEvidence","repeatabilityEvidence","riskEvidence","nextValidation"] } }
  }, required: ["candidates"]
};

function normalizeScore(value: unknown): number {
  const n = Number(value); if (!Number.isFinite(n)) return 0;
  const scaled = n >= 0 && n <= 1 ? n * 100 : n;
  return Math.round(Math.max(0, Math.min(100, scaled)));
}

function extractSourceUrls(candidate: Candidate): string[] {
  const fields = [candidate.demandEvidence, candidate.accessEvidence, candidate.economicsEvidence, candidate.repeatabilityEvidence, candidate.riskEvidence];
  const urls = fields.flatMap((field) => String(field || "").match(/https?:\/\/[^\s)\],]+/g) || []);
  return Array.from(new Set(urls));
}

function extractExaResultSources(data: any): { title:string; url:string }[] {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((result:any) => ({ title:String(result?.title || result?.url || "Source"), url:String(result?.url || "").trim() }))
    .filter((source:{title:string;url:string}) => /^https?:\/\//.test(source.url));
}

function readableError(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
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
    return NextResponse.json({ configured:false, runs:[], error:readableError(error,"Discovery history read failed") }, { status:500 });
  }
}

export async function POST(req: Request) {
  const key = process.env.EXA_API_KEY;
  if (!key) return NextResponse.json({ ok:false, configured:false, error:"Research provider is not configured in the app. A server-side EXA_API_KEY is required for deployed research." }, { status:503 });
  try {
    let body:any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ ok:false, configured:true, error:"The dashboard sent an invalid or empty JSON request body." }, { status:400 }); }
    const goal = String(body?.goal || "").trim();
    const marketScope = String(body.marketScope || "Global").trim();
    const existingRunId = String(body?.existingRunId || "").trim();
    if (!goal) return NextResponse.json({ ok:false, error:"A research goal is required." }, { status:400 });

    const prompt = `Research goal: ${goal}\nMarket scope: ${marketScope}\n\nThis is a RESEARCH-ONLY test. Do not recommend contacting anyone, spending money, creating accounts, making commitments, or taking irreversible actions.\n\nFind concrete business or service opportunities that fit the goal. For every candidate, investigate FIVE separate dimensions: (1) demand, (2) customer access, (3) economics/monetization, (4) repeatability, and (5) risks/competition/compliance. For each dimension, clearly separate sourced evidence from inference and state when evidence is weak, conflicting, indirect, or missing.\n\nSet pursuitPriority from 0-100 using only the strength and completeness of the evidence across those five dimensions. Set confidence from 0-100 based on source quality, independence/corroboration, recency where relevant, and how much of the assessment is actually evidenced. Do not use arbitrary low scores just because this is an early test. Do not treat the priority score as a prediction of business success.\n\nInclude concrete risks clearly inside riskEvidence and give exactly one nextValidation step that would most efficiently resolve the biggest remaining uncertainty. Do not add source fields to the structured output; the application captures the source URLs separately from Exa's search results. Do not invent sources. The result should help an owner decide what deserves further investigation, while preserving uncertainty rather than hiding it.`;

    const response = await fetch("https://api.exa.ai/search", {
      method:"POST", headers:{ "x-api-key":key, "Content-Type":"application/json" },
      body:JSON.stringify({ query:prompt, type:"deep", outputSchema, numResults:10 }), cache:"no-store"
    });
    const raw = await response.text();
    let data:any = null;
    if (raw.trim()) { try { data = JSON.parse(raw); } catch { data = { raw }; } }
    if (!response.ok) {
      const detail = data?.error || data?.message || data?.raw || `Exa request failed: ${response.status}`;
      return NextResponse.json({ ok:false, configured:true, error:readableError(detail,`Exa request failed: ${response.status}`) }, { status:502 });
    }
    if (!data) return NextResponse.json({ ok:false, configured:true, error:"Exa returned an empty response." }, { status:502 });

    const output = data?.output?.content ?? data?.output ?? data?.answer ?? data;
    let parsed:any = output;
    if (typeof output === "string") {
      try { parsed = JSON.parse(output); }
      catch { return NextResponse.json({ ok:false, configured:true, error:"Exa returned research content that was not valid JSON." }, { status:502 }); }
    }
    const summary = parsed?.summary || `Research completed for "${goal}" with ${Array.isArray(parsed?.candidates) ? parsed.candidates.length : 0} candidate opportunities.`;
    const candidates: Candidate[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const sourceUrls = extractExaResultSources(data);
    const resultUrls = sourceUrls.map((source) => source.url);
    let runId:string | null = existingRunId || null;
    let promotedOpportunities: { id:string; name:string; pursuitPriority:number; confidence:number }[] = [];

    if (supabaseConfigured()) {
      if (!runId) {
        const created = await supabaseRequest("discovery_runs", { method:"POST", body:JSON.stringify({ goal, market_scope:marketScope, mode:"RESEARCH_ONLY", status:"RUNNING", summary:"" }), headers:{"Prefer":"return=representation"} });
        runId = created?.[0]?.id || null;
      } else {
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), { method:"PATCH", body:JSON.stringify({ status:"RUNNING", summary:"Research is running…" }), headers:{"Prefer":"return=minimal"} });
      }
      if (!runId) throw new Error("Discovery run could not be recorded.");
      try {
        if (candidates.length > 0) {
          const rows = candidates.map((candidate) => ({
            run_id:runId, name:String(candidate.name || "Unnamed opportunity"), opportunity_type:"", market:marketScope,
            rationale:String(candidate.demandEvidence || ""), pursuit_priority:normalizeScore(candidate.pursuitPriority), confidence:normalizeScore(candidate.confidence),
            demand_evidence:String(candidate.demandEvidence || ""), access_evidence:String(candidate.accessEvidence || ""), economics_evidence:String(candidate.economicsEvidence || ""),
            repeatability_evidence:String(candidate.repeatabilityEvidence || ""), risk_evidence:String(candidate.riskEvidence || ""), risks:[], next_validation:String(candidate.nextValidation || ""),
            source_urls:Array.from(new Set([...extractSourceUrls(candidate), ...resultUrls]))
          }));
          await supabaseRequest("research_candidates", { method:"POST", body:JSON.stringify(rows), headers:{"Prefer":"return=minimal"} });

          const opportunityRows = candidates.map((candidate, index) => {
            const name = String(candidate.name || "Unnamed opportunity");
            const id = `research-${runId}-${index}`;
            const priority = normalizeScore(candidate.pursuitPriority);
            return {
              id,
              name,
              model:"Research candidate",
              capital:"To validate",
              status:"CANDIDATE",
              why:String(candidate.demandEvidence || candidate.accessEvidence || "Research candidate generated from the discovery run."),
              next_action:String(candidate.nextValidation || "Verify the strongest remaining uncertainty."),
              priority
            };
          });
          await supabaseRequest("opportunities", { method:"POST", body:JSON.stringify(opportunityRows.map(({priority, ...row}) => row)), headers:{"Prefer":"return=minimal"} });

          // Verification is a ledger keyed by opportunity_id. Research can be rerun,
          // so do not blindly insert rows that already exist. Preserve any dimensions
          // the agent has already checked and create only missing verification records.
          const opportunityIds = opportunityRows.map(({id}) => id);
          const existingVerification = opportunityIds.length > 0
            ? await supabaseRequest(
                "opportunity_verification?opportunity_id=in.(" +
                opportunityIds.map((id) => encodeURIComponent(id)).join(",") +
                ")&select=*"
              )
            : [];
          const existingByOpportunity = new Map(
            (Array.isArray(existingVerification) ? existingVerification : [])
              .map((row:any) => [String(row?.opportunity_id || ""), row])
          );

          const missingVerificationRows = opportunityRows
            .filter(({id}) => !existingByOpportunity.has(id))
            .map(({id}) => ({
              opportunity_id:id,
              demand:"UNVERIFIED",
              access:"UNVERIFIED",
              margin:"UNVERIFIED",
              repeatability:"UNVERIFIED",
              risk:"UNVERIFIED"
            }));

          if (missingVerificationRows.length > 0) {
            await supabaseRequest("opportunity_verification", {
              method:"POST",
              body:JSON.stringify(missingVerificationRows),
              headers:{"Prefer":"resolution=ignore-duplicates,return=minimal"}
            });
          }

          const evidenceRows = opportunityRows.flatMap((opportunity, index) => {
            const candidate = candidates[index];
            const source = resultUrls[0] || `Discovery research run ${runId}`;
            const checked = new Date().toISOString().slice(0, 10);
            return [
              { opportunity_id:opportunity.id, type:"RESEARCH", claim:`${opportunity.name}: demand evidence`, source, checked_on:checked, quality:"UNVERIFIED", notes:String(candidate.demandEvidence || "Research evidence captured; verify before relying on it.") },
              { opportunity_id:opportunity.id, type:"RESEARCH", claim:`${opportunity.name}: customer access evidence`, source, checked_on:checked, quality:"UNVERIFIED", notes:String(candidate.accessEvidence || "Research evidence captured; verify before relying on it.") },
              { opportunity_id:opportunity.id, type:"RESEARCH", claim:`${opportunity.name}: economics evidence`, source, checked_on:checked, quality:"UNVERIFIED", notes:String(candidate.economicsEvidence || "Research evidence captured; verify before relying on it.") },
              { opportunity_id:opportunity.id, type:"RESEARCH", claim:`${opportunity.name}: repeatability evidence`, source, checked_on:checked, quality:"UNVERIFIED", notes:String(candidate.repeatabilityEvidence || "Research evidence captured; verify before relying on it.") },
              { opportunity_id:opportunity.id, type:"RESEARCH", claim:`${opportunity.name}: risk evidence`, source, checked_on:checked, quality:"UNVERIFIED", notes:String(candidate.riskEvidence || "Research evidence captured; verify before relying on it.") }
            ];
          });
          if (evidenceRows.length > 0) await supabaseRequest("evidence", { method:"POST", body:JSON.stringify(evidenceRows), headers:{"Prefer":"return=minimal"} });

          // Verification owns the next step. Do not create a monetization task
          // from research; the business brain selects one only after the full
          // current research set is verified.
          promotedOpportunities = opportunityRows.map(({id,name,priority}) => ({ id, name, pursuitPriority:priority, confidence:normalizeScore(candidates.find((candidate) => String(candidate.name || "Unnamed opportunity") === name)?.confidence) }));
        }
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), { method:"PATCH", body:JSON.stringify({ status:"COMPLETE", summary:String(summary), completed_at:new Date().toISOString() }), headers:{"Prefer":"return=minimal"} });
      } catch (persistError) {
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), { method:"PATCH", body:JSON.stringify({ status:"FAILED", summary:"Research completed, but persistence failed before the run could be fully recorded." }), headers:{"Prefer":"return=minimal"} }).catch(() => {});
        throw persistError;
      }
    }
    return NextResponse.json({ ok:true, configured:true, goal, marketScope, researchOnly:true, runId, persisted:Boolean(runId), summary, candidates, sourceUrls, promotedOpportunities });
  } catch (error) {
    return NextResponse.json({ ok:false, error:readableError(error,"Discovery request failed") }, { status:500 });
  }
}
