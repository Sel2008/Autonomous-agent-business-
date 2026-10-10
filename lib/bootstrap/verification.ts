import { runBusinessAI } from "../ai-router";
import type { BootstrapOpportunity, ExecutionMode } from "./types";

const schema={type:"object",additionalProperties:false,properties:{
  eligible:{type:"boolean"},payoutVerified:{type:"boolean"},automationAllowed:{type:"boolean"},
  automationEvidence:{type:"string"},
  executionMode:{type:"string",enum:["API","BROWSER_AUTOMATION","MANUAL_ONLY","BLOCKED"]},
  riskStatus:{type:"string",enum:["PASS","REVIEW","BLOCKED"]},reason:{type:"string"}
},required:["eligible","payoutVerified","automationAllowed","automationEvidence","executionMode","riskStatus","reason"]};

// An AI assertion is not enough to authorize automation. Require a verbatim
// source excerpt that explicitly permits automated/programmatic activity.
const explicitAutomationPermission=/\b(?:automation|automated access|automated use|bots?|programmatic access|API access|automated submissions?)\b.{0,100}\b(?:is permitted|are permitted|is allowed|are allowed|may be used|may automate|expressly permitted|expressly allowed)\b|\b(?:is permitted|are permitted|is allowed|are allowed|may be used|may automate|expressly permitted|expressly allowed)\b.{0,100}\b(?:automation|automated access|automated use|bots?|programmatic access|API access|automated submissions?)\b/i;

function safeSourceUrl(value:string){
  try{
    const u=new URL(value);
    if(u.protocol!=="https:") return false;
    const h=u.hostname.toLowerCase();
    if(h==="localhost" || h==="::1" || h==="0.0.0.0" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) || h==="169.254.169.254" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
    return true;
  }catch{return false}
}

export async function verifyOpportunity(op:BootstrapOpportunity){
  if(!safeSourceUrl(op.source_url)) return {ok:false,error:"Unsafe or invalid source URL."};

  // Do not follow redirects from an untrusted candidate URL. A redirect could
  // otherwise point the server-side fetch at an internal service.
  const r=await fetch(op.source_url,{redirect:"manual",cache:"no-store"}).catch(()=>null);
  if(!r || (r.status>=300 && r.status<400)) {
    return {ok:false,error:"The source page redirected or could not be fetched safely."};
  }
  const text=r.ok?(await r.text()).slice(0,12000):"";
  if(!text) return {ok:false,error:"The source page could not be fetched."};

  const ai=await runBusinessAI({prompt:[
    "Verify this bootstrap earning opportunity using ONLY the supplied source page content.",
    "Never infer that automation is allowed. It must be explicitly permitted by the source.",
    "Return automationEvidence as an exact, short quotation from the source that explicitly permits bots, automation, programmatic access, or API access for the relevant activity. If no such quotation exists, return an empty string and set automationAllowed=false and executionMode=MANUAL_ONLY.",
    "Never infer eligibility or payout. If unclear, false.",
    "Block pay-to-work, deposits, crypto access deposits, starter packages, fake engagement, or prohibited automation.",
    "Opportunity:",JSON.stringify(op),"SOURCE PAGE:",text
  ].join("\n"),schema});
  if(!ai) return {ok:false,error:"No AI provider was available for verification."};
  let v:any; try{v=JSON.parse(ai.text)}catch{return {ok:false,error:"Provider verification returned invalid JSON."}};

  const evidence=String(v.automationEvidence||"").trim();
  const evidenceIsVerbatim=Boolean(evidence) && text.toLowerCase().includes(evidence.toLowerCase());
  const automationPermitted=Boolean(v.automationAllowed) && evidenceIsVerbatim && explicitAutomationPermission.test(evidence);
  const safeVerification={
    ...v,
    automationAllowed:automationPermitted,
    executionMode:automationPermitted ? v.executionMode : (v.executionMode==="BLOCKED" ? "BLOCKED" : "MANUAL_ONLY"),
    reason:automationPermitted
      ? String(v.reason||"")
      : [String(v.reason||""),"Automation remains disabled because the source did not provide a verifiable explicit permission quotation."].filter(Boolean).join(" ")
  };
  return {ok:true,verification:safeVerification};
}

export function applyVerification(op:BootstrapOpportunity,v:any){
  const mode=String(v.executionMode||"MANUAL_ONLY") as ExecutionMode;
  const blocked=mode==="BLOCKED" || v.riskStatus==="BLOCKED";
  const autonomousReady=!blocked && Boolean(v.eligible) && Boolean(v.payoutVerified) && Boolean(v.automationAllowed) && mode!=="MANUAL_ONLY";
  return {
    eligibility_verified:Boolean(v.eligible),
    payout_verified:Boolean(v.payoutVerified),
    automation_allowed:Boolean(v.automationAllowed),
    risk_status:blocked?"BLOCKED":v.riskStatus,
    status:blocked?"BLOCKED":(autonomousReady?"READY":"VERIFIED"),
    notes:JSON.stringify({previous:op.notes,executionMode:mode,automationEvidence:String(v.automationEvidence||""),details:String(v.reason||""),verifiedAt:new Date().toISOString()})
  };
}
