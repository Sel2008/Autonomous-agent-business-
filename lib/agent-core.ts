export type AgentAction = {
  opportunityId: string;
  action: string;
  reason: string;
  permission: "READ_ONLY" | "OWNER_APPROVAL_REQUIRED";
  status: "READY" | "WAITING" | "IN_PROGRESS";
};

type Task = { id: string; opportunity_id: string; title: string; status: string };
type Approval = { status: string; title?: string; reason?: string };
type Verification = Record<string, string>;

export function getNextAction(input: {
  tasks: Task[];
  approvals: Approval[];
  verification: Record<string, Verification>;
}): AgentAction {
  const pendingApproval = input.approvals.find((a) => a.status === "PENDING");
  if (pendingApproval) {
    return {
      opportunityId: "system",
      action: "Wait for owner approval",
      reason: pendingApproval.title || pendingApproval.reason || "A pending approval blocks the next controlled action.",
      permission: "OWNER_APPROVAL_REQUIRED",
      status: "WAITING",
    };
  }

  const inProgress = input.tasks.find((t) => t.status === "IN PROGRESS");
  if (inProgress) {
    return {
      opportunityId: inProgress.opportunity_id,
      action: inProgress.title,
      reason: "A task is already in progress, so the agent should continue that workflow before starting another.",
      permission: "READ_ONLY",
      status: "IN_PROGRESS",
    };
  }

  const verificationEntries = Object.entries(input.verification);
  for (const [opportunityId, dimensions] of verificationEntries) {
    const nextDimension = Object.entries(dimensions).find(([, value]) => value === "UNVERIFIED");
    if (nextDimension) {
      return {
        opportunityId,
        action: `Verify ${nextDimension[0]}`,
        reason: "The opportunity still has an unverified verification dimension.",
        permission: "READ_ONLY",
        status: "READY",
      };
    }
  }

  const ready = input.tasks.find((t) => t.status === "READY");
  if (ready) {
    return {
      opportunityId: ready.opportunity_id,
      action: ready.title,
      reason: "No blocking approval or in-progress task was found, so the next ready task can be worked on.",
      permission: "READ_ONLY",
      status: "READY",
    };
  }

  return {
    opportunityId: "system",
    action: "Review ledger for new work",
    reason: "There is no pending approval, active task, or unverified verification dimension in the current ledger.",
    permission: "READ_ONLY",
    status: "READY",
  };
}
