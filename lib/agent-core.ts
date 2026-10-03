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

  // Do not monetize the first candidate that reaches 100%. Finish the
  // verification set first so the central brain can compare all candidates.
  const hasUnverifiedCandidates = verificationEntries.some(([, dimensions]) =>
    ["demand", "access", "margin", "repeatability", "risk"].some(
      (key) => dimensions[key] !== "CHECKED" && dimensions[key] !== "STRONG"
    )
  );

  if (!hasUnverifiedCandidates && verificationEntries.length > 0) {
    return {
      opportunityId: "system",
      action: "Select verified opportunity for monetization",
      reason: "All currently known opportunities are fully verified; compare the evidence and select one before monetization.",
      permission: "READ_ONLY",
      status: "READY",
    };
  }

  // Finish verification for the opportunity already being worked on before
  // jumping to a new candidate. This makes repeated runs progress through the
  // dimensions for one opportunity instead of repeatedly starting at demand
  // on different opportunities.
  const candidates = verificationEntries
    .map(([opportunityId, dimensions], index) => {
      const dimensionsList = Object.entries(dimensions);
      const nextDimension = dimensionsList.find(([, value]) => value === "UNVERIFIED");
      const checkedCount = dimensionsList.filter(
        ([, value]) => value === "CHECKED" || value === "STRONG"
      ).length;
      return { opportunityId, nextDimension, checkedCount, index };
    })
    .filter((x) => Boolean(x.nextDimension))
    .sort((a, b) => b.checkedCount - a.checkedCount || a.index - b.index);

  const verificationTarget = candidates[0];
  if (verificationTarget?.nextDimension) {
    const [dimension] = verificationTarget.nextDimension;
    return {
      opportunityId: verificationTarget.opportunityId,
      action: `Verify ${dimension}`,
      reason:
        verificationTarget.checkedCount > 0
          ? "Continue verification on the opportunity already being validated before starting a new candidate."
          : "The opportunity still has an unverified verification dimension.",
      permission: "READ_ONLY",
      status: "READY",
    };
  }

  const ready = input.tasks.find((t) => t.status === "READY");
  if (ready) {
    const consequential = /^Send approved outreach/i.test(ready.title);
    return {
      opportunityId: ready.opportunity_id,
      action: ready.title,
      reason: consequential
        ? "The outreach action is consequential and can only run after its owner approval is APPROVED."
        : "No blocking approval or in-progress task was found, so the next ready task can be worked on.",
      permission: consequential ? "OWNER_APPROVAL_REQUIRED" : "READ_ONLY",
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
