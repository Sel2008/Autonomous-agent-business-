import { runBusinessAI } from "../ai-router";
import type { BootstrapOpportunity, ExecutionMode } from "./types";

const schema={type:"object",additionalProperties:false,properties:{
  eligible:{type:"boolean"},payoutVerified:{type:"boolean"},automationAllowed:{type:"boolean"},
  executionMode:{type:"string",enum:["API","BROWSER_AUTOMATION","MANUAL_ONLY","BLOCKED"]},
  riskStatus:{type:"string",enum:["PASS","REVIEW","BLOCKED"]},reason:{type:"string"}
},required:["eligible","payoutVerified","automationAllowed","executionMode","riskStatus","reason"]};

export async function verifyOpportunity(op:BootstrapOpportunity){
  const r=await fetch(op.source_url,{redirect:"follow",cache:"no-store"}).catch(()=>null);
  const text=r&&r.ok?(await r.text()).slice(0,12000):"";
  const ai=await runBusinessAI({prompt:[
    "Verify this bootstrap earning opportunity using ONLY the supplied official source page content.",
    "Never infer that automation is allowed. It must be explicit. If unclear, MANUAL_ONLY.",
    "Never infer eligibility or payout. If unclear, false.",
    "Block pay-to-work, deposits, crypto access deposits, starter packages, fake engagement, or prohibited automation.",
    "Opportunity:",JSON.stringify(op),"SOURCE PAGE:",text
  ].join("\n"),schema});
  if(!ai) return {ok:false,error:"No AI provider was available for verification."};
  let v:any; try{v=JSON.parse(ai.text)}catch{return {ok:false,error:"Provider verification returned invalid JSON."}};
  return {ok:true,verification:v};
}

export function applyVerification(op:BootstrapOpportunity,v:any){
  const mode=String(v.executionMode||"MANUAL_ONLY") as ExecutionMode;
  const blocked=mode==="BLOCKED" || v.riskStatus==="BLOCKED" || !v.eligible || !v.payoutVerified || !v.automationAllowed;
  return {
    eligibility_verified:Boolean(v.eligible),
    payout_verified:Boolean(v.payoutVerified),
    automation_allowed:Boolean(v.automationAllowed),
    risk_status:blocked?"BLOCKED":v.riskStatus,
    status:blocked?"BLOCKED":"READY",
    notes:JSON.stringify({previous:op.notes,executionMode:mode,verificationReason:String(v.reason||""),verifiedAt:new Date().toISOString()})
  };
}
