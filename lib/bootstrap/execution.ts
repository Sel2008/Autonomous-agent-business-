import type { BootstrapOpportunity } from "./types";

export type BootstrapExecutionResult =
  | { ok:true; status:"IN_PROGRESS"|"SUBMITTED"|"PENDING_PAYOUT"; externalTaskId?:string; grossAmount?:number; currency?:string; notes?:string }
  | { ok:false; status:"MANUAL_ONLY"|"BLOCKED"|"UNAVAILABLE"; reason:string };

export type BootstrapExecutionAdapter = {
  provider:string;
  supports:(opportunity:BootstrapOpportunity)=>boolean;
  execute:(opportunity:BootstrapOpportunity)=>Promise<BootstrapExecutionResult>;
};

/**
 * Providers must explicitly opt into this registry. Discovery alone never
 * grants execution permission. A provider adapter must implement the actual
 * permitted workflow and return a real external task/result.
 */
export const BOOTSTRAP_EXECUTION_ADAPTERS:BootstrapExecutionAdapter[]=[];

export function adapterFor(opportunity:BootstrapOpportunity){
  return BOOTSTRAP_EXECUTION_ADAPTERS.find(a=>a.supports(opportunity))||null;
}
