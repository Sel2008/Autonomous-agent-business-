import { createHash } from "crypto";
import { runBusinessAIWithDiagnostics } from "../ai-router";
import type { ProviderDiscoveryResult, ExecutionMode, RiskStatus } from "./types";

function idFor(value:string){
  // bootstrap_opportunities.id is a UUID in Supabase. Keep discovery IDs
  // deterministic so repeated discovery upserts the same opportunity instead
  // of creating duplicates, while still producing a valid UUID.
  const hex=createHash("sha1").update(value.trim().toLowerCase()).digest("hex").slice(0,32);
  const chars=hex.split("");
  chars[12]="5";
  chars[16]=((parseInt(chars[16],16)&0x3)|0x8).toString(16);
  return chars.join("").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5");
}

async function exaSearch(query:string){
  const key=process.env.EXA_API_KEY;
  if(!key) throw new Error("EXA_API_KEY is missing in the server environment.");
  const r=await fetch("https://api.exa.ai/search",{
    method:"POST",
    headers:{"x-api-key":key,"Content-Type":"application/json"},
    body:JSON.stringify({query,numResults:6,type:"auto",contents:{text:{maxCharacters:1600}}}),
    cache:"no-store",
    signal:AbortSignal.timeout(10000)
  });
  if(!r.ok) throw new Error(`Exa discovery failed with HTTP ${r.status}.`);
  const data=await r.json().catch(()=>null);
  return Array.isArray(data?.results)?data.results:[];
}

const schema={
  type:"object",additionalProperties:false,
  properties:{
    opportunities:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      provider:{type:"string"},title:{type:"string"},sourceUrl:{type:"string"},workType:{type:"string"},
      payoutDescription:{type:"string"},estimatedPayout:{type:"number"},currency:{type:"string"},
      upfrontCost:{type:"number"},automationAllowed:{type:"boolean"},
      executionMode:{type:"string",enum:["API","BROWSER_AUTOMATION","MANUAL_ONLY","BLOCKED"]},
      eligibilityVerified:{type:"boolean"},payoutVerified:{type:"boolean"},
      riskStatus:{type:"string",enum:["UNVERIFIED","REVIEW","PASS","BLOCKED"]},notes:{type:"string"}
    },required:["provider","title","sourceUrl","workType","payoutDescription","estimatedPayout","currency","upfrontCost","automationAllowed","executionMode","eligibilityVerified","payoutVerified","riskStatus","notes"]}}
  },required:["opportunities"]
};

export async function discoverViaExa(query:string):Promise<ProviderDiscoveryResult[]>{
  const results=await exaSearch(query);
  if(!results.length) throw new Error("Exa returned zero web results for the bootstrap discovery query.");
  // Keep the prompt small to stretch free-tier token quotas.
  // Source URLs are still checked against the original Exa results.
  // Unknown automation permission remains MANUAL_ONLY; reducing context never relaxes safety gates.
  const compact=results.slice(0,4).map((r:any)=>({title:r.title,url:r.url,text:String(r.text||"").slice(0,900)}));
  const ai=await runBusinessAIWithDiagnostics({prompt:[
    "You are the safety verifier for an autonomous bootstrap-earnings engine.",
    "Extract only opportunities supported by the supplied web-source text.",
    "Do not invent provider rules, eligibility, payouts, or automation permission.",
    "A provider is automationAllowed=true ONLY when the source explicitly supports automation/API/browser automation for this type of worker activity. Otherwise set false and executionMode MANUAL_ONLY.",
    "A provider is payoutVerified=true ONLY when the source explicitly describes payout/reward mechanics. Otherwise false.",
    "A provider is eligibilityVerified=true ONLY when the source explicitly supports the relevant worker eligibility; otherwise false.",
    "Any pay-to-work, deposit-to-unlock, crypto deposit, starter package, fake engagement, or prohibited automation must be BLOCKED.",
    "estimatedPayout must be 0 when no concrete payout is supported by the source.",
    "Return only candidates with a real source URL from the supplied results. Do not manufacture URLs.",
    "SOURCES:",JSON.stringify(compact)
  ].join("\n"),schema});
  if(!ai.result) {
    const details=ai.diagnostics.map(d=>`${d.provider}/${d.model}: ${d.error}`).join(" | ");
    throw new Error(`All configured AI providers failed to return a usable bootstrap discovery result. ${details}`);
  }
  const cleaned=ai.result.text.replace(/^\\s*```(?:json)?\\s*/i,"").replace(/\\s*```\\s*$/,"").trim();
  let parsed:any=null;
  try{parsed=JSON.parse(cleaned)}catch{}
  const list=Array.isArray(parsed?.opportunities)?parsed.opportunities:[];
  if(!list.length) {
    throw new Error(`AI provider ${ai.result.provider} returned no parseable bootstrap opportunities.`);
  }
  const allowedUrls=new Set(compact.map((x:any)=>String(x.url||"")).filter(Boolean));
  return list.filter((x:any)=>allowedUrls.has(String(x?.sourceUrl||""))).map((x:any)=>({
    provider:String(x.provider),title:String(x.title),sourceUrl:String(x.sourceUrl),
    workType:String(x.workType),payoutDescription:String(x.payoutDescription),
    estimatedPayout:Math.max(0,Number(x.estimatedPayout||0)),currency:String(x.currency||"USD"),
    upfrontCost:Math.max(0,Number(x.upfrontCost||0)),automationAllowed:Boolean(x.automationAllowed),
    executionMode:String(x.executionMode||"MANUAL_ONLY") as ExecutionMode,
    eligibilityVerified:Boolean(x.eligibilityVerified),payoutVerified:Boolean(x.payoutVerified),
    riskStatus:String(x.riskStatus||"REVIEW") as RiskStatus,notes:String(x.notes||"")
  }));
}

export function opportunityRow(x:ProviderDiscoveryResult){
  const blocked=x.executionMode==="BLOCKED" || x.riskStatus==="BLOCKED" || x.upfrontCost>0;
  const autonomousReady=!blocked && x.automationAllowed && x.eligibilityVerified && x.payoutVerified && x.executionMode!=="MANUAL_ONLY";
  return {
    id:idFor(x.provider+"-"+x.title),
    title:x.title,provider:x.provider,source_url:x.sourceUrl,work_type:x.workType,
    payout_description:x.payoutDescription,estimated_payout:x.estimatedPayout,currency:x.currency,
    upfront_cost:x.upfrontCost,automation_allowed:x.automationAllowed,
    eligibility_verified:x.eligibilityVerified,payout_verified:x.payoutVerified,
    risk_status:blocked?"BLOCKED":x.riskStatus,
    status:blocked?"BLOCKED":(autonomousReady?"READY":"DISCOVERED"),
    notes:JSON.stringify({executionMode:x.executionMode,details:x.notes,discoveredAt:new Date().toISOString()})
  };
}
