import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";
import { runBusinessAI } from "../../../../lib/ai-router";

function errorText(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  try { return value ? JSON.stringify(value) : fallback; } catch { return fallback; }
}

export async function POST(req: Request) {
  try {
    if (!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
    const exaKey=process.env.EXA_API_KEY;
    if(!exaKey) return NextResponse.json({ok:false,error:"EXA_API_KEY is required for lead research."},{status:503});

    const body=await req.json().catch(()=>({}));
    const opportunityId=String(body?.opportunityId||"").trim();
    if(!opportunityId) return NextResponse.json({ok:false,error:"opportunityId is required."},{status:400});

    const opportunities=await supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*");
    const opportunity=Array.isArray(opportunities)?opportunities[0]:null;
    if(!opportunity) return NextResponse.json({ok:false,error:"Opportunity not found."},{status:404});

    const plans=await supabaseRequest("evidence?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&type=eq.MONETIZATION_PLAN&order=created_at.desc&limit=1&select=*");
    const plan=Array.isArray(plans)?plans[0]:null;
    const query=[
      "Find 5 real businesses that could plausibly buy this service: "+String(opportunity.name||""),
      "Use public business websites or reputable public directories.",
      "Prefer businesses with an observable operational or marketing need related to the service.",
      "Return public company/business information only. Do not look for private personal data.",
      "This is preparation only; do not contact anyone."
    ].join(" ");

    const exa=await fetch("https://api.exa.ai/search",{
      method:"POST",
      headers:{"x-api-key":exaKey,"Content-Type":"application/json"},
      body:JSON.stringify({query,type:"deep",numResults:10}),
      cache:"no-store"
    });
    const raw=await exa.text();
    if(!exa.ok) return NextResponse.json({ok:false,error:"Lead research failed: "+raw.slice(0,600)},{status:502});
    const exaData=raw.trim()?JSON.parse(raw):null;
    const results=Array.isArray(exaData?.results)?exaData.results:[];
    const research=results.slice(0,8).map((r:any)=>({
      title:String(r?.title||"Business"),
      url:String(r?.url||""),
      text:String(r?.text||r?.snippet||r?.summary||"").replace(/\s+/g," ").slice(0,1200)
    })).filter((r:any)=>/^https?:\/\//.test(r.url));

    const schema={
      type:"object",additionalProperties:false,
      properties:{
        leads:{type:"array",items:{type:"object",additionalProperties:false,properties:{
          businessName:{type:"string"},website:{type:"string"},fitReason:{type:"string"},personalizedMessage:{type:"string"},offerAngle:{type:"string"}
        },required:["businessName","website","fitReason","personalizedMessage","offerAngle"]}}
      },
      required:["leads"]
    };
    const prompt=[
      "Create a small first-outreach pack for the validated business opportunity.",
      "Use only the public research supplied below. Do not invent a business fact.",
      "Choose up to 5 plausible businesses. Do not include private contact details.",
      "Write concise, respectful, non-spammy personalized drafts. They are drafts only and must not be sent automatically.",
      "Mention the concrete service outcome and a low-friction first paid test without claiming guaranteed results.",
      "OPPORTUNITY:",JSON.stringify(opportunity),
      "MONETIZATION PLAN:",String(plan?.notes||""),
      "PUBLIC RESEARCH:",JSON.stringify(research)
    ].join("\n");

    const ai=await runBusinessAI({prompt,schema});
    if(!ai) return NextResponse.json({
      ok:false,
      error:"No AI provider was available for outreach drafting. The agent will retry on the next heartbeat."
    },{status:503});
    let pack:any;
    try{pack=JSON.parse(String(ai.text||""));}catch{throw new Error("Business AI returned an invalid outreach pack.");}
    const leads=Array.isArray(pack?.leads)?pack.leads.slice(0,5):[];

    const notes=leads.map((lead:any,i:number)=>[
      "Lead "+(i+1)+": "+String(lead.businessName||""),
      "Website: "+String(lead.website||""),
      "Fit: "+String(lead.fitReason||""),
      "Offer angle: "+String(lead.offerAngle||""),
      "Draft: "+String(lead.personalizedMessage||"")
    ].join("\n")).join("\n\n");

    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"OUTREACH_PACK",
        claim:"Agent prepared "+leads.length+" prospective customer outreach drafts",
        source:"Public business research + central business brain",
        checked_on:new Date().toISOString().slice(0,10),
        quality:"CHECKED",
        notes
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const tasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&status=eq.READY&select=*");
    const outreachTask=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("prepare outreach pack")):null;
    if(outreachTask?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(outreachTask.id),{
      method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
    });

    const sendTaskId="research-"+opportunityId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-send";
    const allTasks=await supabaseRequest("tasks?id=eq."+encodeURIComponent(sendTaskId)+"&select=*");
    if(!Array.isArray(allTasks)||allTasks.length===0){
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({id:sendTaskId,title:"Send approved outreach: "+String(opportunity.name||"opportunity"),status:"READY",opportunity_id:opportunityId}),
        headers:{"Prefer":"return=minimal"}
      });
    }

    const approvalTitle="Approve sending outreach: "+String(opportunity.name||"opportunity");
    // approvals.id is a UUID in Supabase, so let the database generate it.
    // Use the stable approval title for idempotent lookup instead of manufacturing
    // a text ID such as "approval-research-...-outreach".
    const approvals=await supabaseRequest("approvals?title=eq."+encodeURIComponent(approvalTitle)+"&order=created_at.desc&limit=1&select=*");
    let approvalId=Array.isArray(approvals)&&approvals[0]?.id ? String(approvals[0].id) : "";
    if(!approvalId){
      const created=await supabaseRequest("approvals",{
        method:"POST",
        body:JSON.stringify({title:approvalTitle,tier:"T2",status:"PENDING"}),
        headers:{"Prefer":"return=representation"}
      });
      approvalId=Array.isArray(created)&&created[0]?.id ? String(created[0].id) : "";
    }

    return NextResponse.json({ok:true,opportunityId,leads,approvalId,nextTask:sendTaskId});
  } catch(error){
    return NextResponse.json({ok:false,error:errorText(error,"Outreach preparation failed.")},{status:500});
  }
}
