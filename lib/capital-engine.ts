export const CAPITAL_POLICY = {
  availableCapital: 0,
  upfrontSpendAllowed: false,
  ownerApprovalRequiredForSpend: true,
  ownerApprovalRequiredForMoneyMovement: true,
  ownerApprovalRequiredForAccountConnection: true,
  neverPayToUnlockWork: true,
  neverDepositCryptoToAccessEarnings: true,
  neverBuyStarterPackages: true,
  neverFakeReviewsOrEngagement: true,
  neverCircumventPlatformAutomationRules: true,
} as const;

export type CapitalDecision =
  | { kind:"EXECUTE_ZERO_COST"; reason:string }
  | { kind:"QUEUE_FOR_CAPITAL"; reason:string; amount:number; currency:string }
  | { kind:"BLOCK_UNSAFE"; reason:string };

export function classifyCapitalNeed(input:{
  upfrontCost:number;
  automationAllowed:boolean;
  requiresDeposit?:boolean;
  requiresCryptoDeposit?:boolean;
  requiresStarterPackage?:boolean;
  requiresArtificialEngagement?:boolean;
}):CapitalDecision {
  if (input.requiresDeposit || input.requiresCryptoDeposit || input.requiresStarterPackage || input.requiresArtificialEngagement) {
    return {kind:"BLOCK_UNSAFE",reason:"The opportunity violates the zero-capital/safety policy."};
  }
  if (!input.automationAllowed) {
    return {kind:"BLOCK_UNSAFE",reason:"The platform does not permit the required automation."};
  }
  const amount=Number(input.upfrontCost||0);
  if (!Number.isFinite(amount) || amount<0) {
    return {kind:"BLOCK_UNSAFE",reason:"The required upfront cost is invalid."};
  }
  if (amount===0) {
    return {kind:"EXECUTE_ZERO_COST",reason:"The work can start without spending owner or earned capital."};
  }
  return {
    kind:"QUEUE_FOR_CAPITAL",
    reason:"The opportunity requires capital before execution; keep it queued until earned funds exist and the owner approves the spend.",
    amount,
    currency:"ZAR"
  };
}

export function netEarning(gross:number,fees:number) {
  return Math.max(0,Number(gross||0)-Number(fees||0));
}
