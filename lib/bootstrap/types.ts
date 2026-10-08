export type ExecutionMode = "API" | "BROWSER_AUTOMATION" | "MANUAL_ONLY" | "BLOCKED";
export type RiskStatus = "UNVERIFIED" | "REVIEW" | "PASS" | "BLOCKED";
export type BootstrapOpportunity = {
  id:string; title:string; provider:string; source_url:string; work_type:string;
  payout_description:string; estimated_payout:number; currency:string; upfront_cost:number;
  automation_allowed:boolean; eligibility_verified:boolean; payout_verified:boolean;
  risk_status:RiskStatus; status:"DISCOVERED"|"VERIFIED"|"READY"|"ACTIVE"|"PAUSED"|"COMPLETE"|"BLOCKED";
  notes:string;
};
export type ProviderDiscoveryResult = {
  provider:string; title:string; sourceUrl:string; workType:string;
  payoutDescription:string; estimatedPayout:number; currency:string; upfrontCost:number;
  automationAllowed:boolean; executionMode:ExecutionMode;
  eligibilityVerified:boolean; payoutVerified:boolean; riskStatus:RiskStatus; notes:string;
};
