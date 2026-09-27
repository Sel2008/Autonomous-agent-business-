import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../lib/supabase";

type Candidate = {
  name: string;
  opportunityType: string;
  market: string;
  rationale: string;
  pursuitPriority: number;
  confidence: number;
  evidence: string;
  risks: string[];
  nextValidation: string;
  sourceUrls: string[];
};

// Exa Search structured output allows a maximum of 10 properties TOTAL,
// including properties inside the candidate item. Keep the schema compact;
// grounding supplies field-level source citations separately.
const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          rationale: { type: "string" },
          pursuitPriority: { type: "number" },
          confidence: { type: "number" },
          evidence: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          nextValidation: { type: "string" },
          sourceUrls: { type: "array", items: { type: "string" } }
        },
        required: ["name","rationale","pursuitPriority","confidence","evidence","risks","nextValidation","sourceUrls"]
      }
    }
  },
  required: ["summary","candidates"]
};

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ configured:false, runs:[] });
  }

  try {
    const [runs, candidates] = await Promise.all([
      supabaseRequest("discovery_runs?select=*&order=created_at.desc&limit=10"),
      supabaseRequest("research_candidates?select=*&order=created_at.asc"),
    ]);

    const candidateRows = Array.isArray(candidates) ? candidates : [];
    const grouped = (Array.isArray(runs) ? runs : []).map((run:any) => ({
      ...run,
      candidates: candidateRows.filter((candidate:any) => candidate.run_id === run.id),
    }));

    return NextResponse.json({ configured:true, runs:grouped });
  } catch (error) {
    return NextResponse.json({
      configured:false,
      runs:[],
      error:error instanceof Error ? error.message : "Discovery history read failed"
    }, { status:500 });
  }
}

export async function POST(req: Request) {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    return NextResponse.json({
      ok:false,
      configured:false,
      error:"Research provider is not configured in the app. A server-side EXA_API_KEY is required for deployed research."
    }, { status:503 });
  }

  try {
    const body = await req.json();
    const goal = String(body.goal || "").trim();
    const marketScope = String(body.marketScope || "Global").trim();

    if (!goal) {
      return NextResponse.json({ ok:false, error:"A research goal is required." }, { status:400 });
    }

    const prompt = `Research goal: ${goal}
Market scope: ${marketScope}

This is a RESEARCH-ONLY test. Do not recommend contacting anyone, spending money, creating accounts, making commitments, or taking irreversible actions.

Find concrete business opportunities or service opportunities that fit the goal. Investigate each candidate across:
1) evidence of demand,
2) realistic customer/prospect access,
3) economics or monetization evidence,
4) repeatability of delivery,
5) risks, competition, compliance or other blockers.

Rank candidates by a transparent pursuit-priority assessment based on the evidence you found, NOT by an unsupported prediction of success. Separate evidence from inference. If evidence is weak or conflicting, say so. Include source URLs for material claims. The result should help an owner decide what deserves the next validation step.`;

    const response = await fetch("https://api.exa.ai/search", {
      method:"POST",
      headers:{ "x-api-key":key, "Content-Type":"application/json" },
      body:JSON.stringify({
        query:prompt,
        type:"deep",
        outputSchema,
        numResults:10
      }),
      cache:"no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        ok:false,
        configured:true,
        error:data?.error || data?.message || `Exa request failed: ${response.status}`
      }, { status:502 });
    }

    const output = data?.output?.content ?? data?.output ?? data?.answer ?? data;
    let parsed = output;
    if (typeof output === "string") {
      try { parsed = JSON.parse(output); } catch {}
    }

    const summary = parsed?.summary || "";
    const candidates: Candidate[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

    let runId:string | null = null;

    if (supabaseConfigured()) {
      const created = await supabaseRequest("discovery_runs", {
        method:"POST",
        body:JSON.stringify({
          goal,
          market_scope:marketScope,
          mode:"RESEARCH_ONLY",
          status:"RUNNING",
          summary:""
        }),
        headers:{"Prefer":"return=representation"}
      });

      runId = created?.[0]?.id || null;

      if (!runId) throw new Error("Discovery run could not be recorded.");

      try {
        if (candidates.length > 0) {
          const rows = candidates.map((candidate) => ({
            run_id:runId,
            name:String(candidate.name || "Unnamed opportunity"),
            opportunity_type:String(candidate.opportunityType || ""),
            market:String(candidate.market || marketScope),
            rationale:String(candidate.rationale || ""),
            pursuit_priority:Math.max(0, Math.min(100, Number(candidate.pursuitPriority) || 0)),
            confidence:Math.max(0, Math.min(100, Number(candidate.confidence) || 0)),
            demand_evidence:String(candidate.evidence || ""),
            access_evidence:"",
            economics_evidence:"",
            repeatability_evidence:"",
            risk_evidence:Array.isArray(candidate.risks) ? candidate.risks.map(String).join("; ") : "",
            risks:Array.isArray(candidate.risks) ? candidate.risks.map(String) : [],
            next_validation:String(candidate.nextValidation || ""),
            source_urls:Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.map(String) : []
          }));

          await supabaseRequest("research_candidates", {
            method:"POST",
            body:JSON.stringify(rows),
            headers:{"Prefer":"return=minimal"}
          });
        }

        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), {
          method:"PATCH",
          body:JSON.stringify({
            status:"COMPLETE",
            summary:String(summary),
            completed_at:new Date().toISOString()
          }),
          headers:{"Prefer":"return=minimal"}
        });
      } catch (persistError) {
        await supabaseRequest("discovery_runs?id=eq."+encodeURIComponent(runId), {
          method:"PATCH",
          body:JSON.stringify({
            status:"FAILED",
            summary:"Research completed, but persistence failed before the run could be fully recorded."
          }),
          headers:{"Prefer":"return=minimal"}
        }).catch(() => {});
        throw persistError;
      }
    }

    return NextResponse.json({
      ok:true,
      configured:true,
      goal,
      marketScope,
      researchOnly:true,
      runId,
      persisted:Boolean(runId),
      summary,
      candidates,
      grounding:data?.output?.grounding || data?.grounding || []
    });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      error:error instanceof Error ? error.message : "Discovery request failed"
    }, { status:500 });
  }
}
