import { NextResponse } from "next/server";

type Candidate = {
  name: string;
  opportunityType: string;
  market: string;
  rationale: string;
  pursuitPriority: number;
  confidence: number;
  demandEvidence: string;
  accessEvidence: string;
  economicsEvidence: string;
  repeatabilityEvidence: string;
  riskEvidence: string;
  risks: string[];
  nextValidation: string;
  sourceUrls: string[];
};

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
          opportunityType: { type: "string" },
          market: { type: "string" },
          rationale: { type: "string" },
          pursuitPriority: { type: "number" },
          confidence: { type: "number" },
          demandEvidence: { type: "string" },
          accessEvidence: { type: "string" },
          economicsEvidence: { type: "string" },
          repeatabilityEvidence: { type: "string" },
          riskEvidence: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          nextValidation: { type: "string" },
          sourceUrls: { type: "array", items: { type: "string" } }
        },
        required: ["name","opportunityType","market","rationale","pursuitPriority","confidence","demandEvidence","accessEvidence","economicsEvidence","repeatabilityEvidence","riskEvidence","risks","nextValidation","sourceUrls"]
      }
    }
  },
  required: ["summary","candidates"]
};

export async function POST(req: Request) {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    return NextResponse.json({ ok:false, configured:false, error:"EXA_API_KEY is not configured in the app." }, { status:503 });
  }

  try {
    const body = await req.json();
    const goal = String(body.goal || "").trim();
    const marketScope = String(body.marketScope || "Global").trim();
    if (!goal) return NextResponse.json({ ok:false, error:"A research goal is required." }, { status:400 });

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
      return NextResponse.json({ ok:false, configured:true, error:data?.error || data?.message || `Exa request failed: ${response.status}` }, { status:502 });
    }

    const output = data?.output?.content ?? data?.output ?? data?.answer ?? data;
    let parsed = output;
    if (typeof output === "string") {
      try { parsed = JSON.parse(output); } catch {}
    }

    return NextResponse.json({
      ok:true,
      configured:true,
      goal,
      marketScope,
      researchOnly:true,
      summary:parsed?.summary || "",
      candidates:Array.isArray(parsed?.candidates) ? parsed.candidates : [],
      grounding:data?.output?.grounding || data?.grounding || []
    });
  } catch (error) {
    return NextResponse.json({ ok:false, error:error instanceof Error ? error.message : "Discovery request failed" }, { status:500 });
  }
}
