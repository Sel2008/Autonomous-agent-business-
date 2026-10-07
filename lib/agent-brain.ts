import { runBusinessAI } from "./ai-router";

export type BrainDecision = {
  action: string;
  opportunityId: string;
  reason: string;
  permission: "READ_ONLY" | "OWNER_APPROVAL_REQUIRED";
  status: "READY" | "WAITING" | "IN_PROGRESS";
  brain: "AI" | "DETERMINISTIC";
};

const ALLOWED_ACTIONS = [
  "Verify demand",
  "Verify access",
  "Verify margin",
  "Verify repeatability",
  "Verify risk",
  "Select verified opportunity for monetization",
  "Build monetization plan",
  "Prepare outreach pack",
  "Send approved outreach",
  "Learn from business result",
  "Review ledger for new work",
] as const;

export function allowedAction(value: unknown): string | null {
  const action = String(value || "").trim();
  return (ALLOWED_ACTIONS as readonly string[]).includes(action) ? action : null;
}

function parseJson(text:string):any|null {
  try { return JSON.parse(text); } catch {}
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if(fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  return null;
}

const selectionSchema = {
  type:"object", additionalProperties:false,
  properties:{ opportunityId:{type:"string"}, reason:{type:"string"} },
  required:["opportunityId","reason"]
};

export async function askOpportunitySelection(input: {
  opportunities: any[];
  verification: Record<string, Record<string, string>>;
  evidence: any[];
}): Promise<{ opportunityId: string; reason: string } | null> {
  const candidates = input.opportunities
    .filter((op:any) => input.verification[String(op?.id || "")])
    .map((op:any) => ({
      opportunity: op,
      verification: input.verification[String(op.id)],
      evidence: input.evidence.filter((e:any) => String(e?.opportunity_id || "") === String(op.id))
    }));
  if(!candidates.length) return null;

  const prompt=[
    "You are the selection brain of an autonomous business agent.",
    "All supplied candidates have completed every required verification dimension.",
    "Choose exactly ONE candidate for the first monetization test.",
    "Compare the complete set. Prefer stronger and more independent evidence, clearer customer demand, credible customer access, better economics/margin, repeatability, and lower documented risk.",
    "Do not invent facts, scores, revenue, customers, or evidence. If evidence is uncertain, say so in the reason but still choose the strongest candidate.",
    "Return only the ID of one supplied candidate and a concise rationale.",
    "",
    "VERIFIED CANDIDATES:", JSON.stringify(candidates)
  ].join("\n");

  const result=await runBusinessAI({prompt,schema:selectionSchema});
  if(!result) return null;
  const parsed=parseJson(result.text);
  const opportunityId=String(parsed?.opportunityId||"");
  if(!candidates.some((c:any)=>String(c.opportunity?.id||"")===opportunityId)) return null;
  return {opportunityId,reason:String(parsed?.reason||"AI selected the strongest verified opportunity.")};
}

const decisionSchema = {
  type:"object", additionalProperties:false,
  properties:{
    action:{type:"string",enum:ALLOWED_ACTIONS},
    opportunityId:{type:"string"},
    reason:{type:"string"},
    permission:{type:"string",enum:["READ_ONLY","OWNER_APPROVAL_REQUIRED"]},
    status:{type:"string",enum:["READY","WAITING","IN_PROGRESS"]}
  },
  required:["action","opportunityId","reason","permission","status"]
};

export async function askBusinessBrain(input: {
  mission?: string;
  opportunities: any[];
  tasks: any[];
  approvals: any[];
  verification: Record<string, Record<string, string>>;
  evidence?: any[];
}): Promise<BrainDecision | null> {
  const prompt=[
    "You are the central planning brain of an autonomous business agent.",
    "Choose exactly ONE next action from the supplied allowed actions.",
    "Research and validation are safe read-only work. Building plans and outreach drafts are also safe internal preparation.",
    "Sending outreach, spending money, accepting terms, creating accounts, signing contracts, moving money, or any irreversible action requires owner approval.",
    "Never invent completed work. Use the live ledger state only.",
    "Prefer progressing the highest-value live opportunity rather than looping on already-completed work.",
    "If a pending approval exists, wait for it.",
    "Verification is a hard gate: if any opportunity in the live research set has UNVERIFIED verification dimensions, continue verifying before selection.",
    "Selection is a hard gate before monetization: when all current opportunities are fully verified and no opportunity is SELECTED, the next action must be Select verified opportunity for monetization.",
    "Only after one opportunity is durably marked SELECTED may Build monetization plan be chosen, and it must target that selected opportunity.",
    "If an outreach-pack task is READY, choose Prepare outreach pack.",
    "If an approved outreach task is READY, choose Send approved outreach, but permission must be OWNER_APPROVAL_REQUIRED.",
    "If a business-result learning task is READY, choose Learn from business result.",
    "",
    "LIVE LEDGER:", JSON.stringify(input)
  ].join("\n");

  const result=await runBusinessAI({prompt,schema:decisionSchema});
  if(!result) return null;
  const parsed=parseJson(result.text);
  const action=allowedAction(parsed?.action);
  if(!action) return null;
  return {
    action,
    opportunityId:String(parsed?.opportunityId||"system"),
    reason:String(parsed?.reason||"Central business brain selected the next ledger action."),
    permission:parsed?.permission==="OWNER_APPROVAL_REQUIRED"?"OWNER_APPROVAL_REQUIRED":"READ_ONLY",
    status:parsed?.status==="WAITING"?"WAITING":parsed?.status==="IN_PROGRESS"?"IN_PROGRESS":"READY",
    brain:"AI"
  };
}
