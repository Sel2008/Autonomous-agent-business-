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
  "Build monetization plan",
  "Prepare outreach pack",
  "Send approved outreach",
  "Review ledger for new work",
] as const;

export function allowedAction(value: unknown): string | null {
  const action = String(value || "").trim();
  return (ALLOWED_ACTIONS as readonly string[]).includes(action) ? action : null;
}

export async function askBusinessBrain(input: {
  mission?: string;
  opportunities: any[];
  tasks: any[];
  approvals: any[];
  verification: Record<string, Record<string, string>>;
  evidence?: any[];
}): Promise<BrainDecision | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ALLOWED_ACTIONS },
      opportunityId: { type: "string" },
      reason: { type: "string" },
      permission: { type: "string", enum: ["READ_ONLY", "OWNER_APPROVAL_REQUIRED"] },
      status: { type: "string", enum: ["READY", "WAITING", "IN_PROGRESS"] }
    },
    required: ["action","opportunityId","reason","permission","status"]
  };

  const prompt = [
    "You are the central planning brain of an autonomous business agent.",
    "Choose exactly ONE next action from the supplied allowed actions.",
    "Research and validation are safe read-only work. Building plans and outreach drafts are also safe internal preparation.",
    "Sending outreach, spending money, accepting terms, creating accounts, signing contracts, moving money, or any irreversible action requires owner approval.",
    "Never invent completed work. Use the live ledger state only.",
    "Prefer progressing the highest-value live opportunity rather than looping on already-completed work.",
    "If a pending approval exists, wait for it.",
    "If verification has UNVERIFIED dimensions, verify one dimension first.",
    "If verification is complete and a monetization-plan task is READY, choose Build monetization plan.",
    "If an outreach-pack task is READY, choose Prepare outreach pack.",
    "If an approved outreach task is READY, choose Send approved outreach, but permission must be OWNER_APPROVAL_REQUIRED.",
    "",
    "LIVE LEDGER:",
    JSON.stringify(input)
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "agent_next_action",
          strict: true,
          schema
        }
      }
    }),
    cache: "no-store"
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const text = String(data?.output_text || "").trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    const action = allowedAction(parsed?.action);
    if (!action) return null;
    return {
      action,
      opportunityId: String(parsed?.opportunityId || "system"),
      reason: String(parsed?.reason || "Central business brain selected the next ledger action."),
      permission: parsed?.permission === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "READ_ONLY",
      status: parsed?.status === "WAITING" ? "WAITING" : parsed?.status === "IN_PROGRESS" ? "IN_PROGRESS" : "READY",
      brain: "AI"
    };
  } catch {
    return null;
  }
}
