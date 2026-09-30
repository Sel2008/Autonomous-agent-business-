import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

function errorText(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  try { return value ? JSON.stringify(value) : fallback; } catch { return fallback; }
}

export async function POST(req: Request) {
  try {
    if (!supabaseConfigured()) return NextResponse.json({ ok:false, error:"Supabase is not configured." }, { status:503 });
    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ ok:false, error:"Central AI brain is not configured. Add OPENAI_API_KEY to enable monetization planning." }, { status:503 });

    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body?.opportunityId || "").trim();
    if (!opportunityId) return NextResponse.json({ ok:false, error:"opportunityId is required." }, { status:400 });

    const [opportunities, verification] = await Promise.all([
      supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*"),
      supabaseRequest("opportunity_verification?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&select=*")
    ]);
    const opportunity = Array.isArray(opportunities) ? opportunities[0] : null;
    if (!opportunity) return NextResponse.json({ ok:false, error:"Opportunity not found." }, { status:404 });

    const dimensions = Array.isArray(verification) ? verification : [];
    const state = dimensions.reduce((acc:any,row:any)=>{
      for (const k of ["demand","access","margin","repeatability","risk"]) {
        const v=String(row?.[k]||"UNVERIFIED");
        if ((acc[k]||"UNVERIFIED")==="UNVERIFIED" || v==="STRONG") acc[k]=v;
        else if (v==="CHECKED") acc[k]="CHECKED";
      }
      return acc;
    }, {demand:"UNVERIFIED",access:"UNVERIFIED",margin:"UNVERIFIED",repeatability:"UNVERIFIED",risk:"UNVERIFIED"});

    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const schema = {
      type:"object", additionalProperties:false,
      properties:{
        offer:{type:"string"},
        idealCustomer:{type:"string"},
        problemSolved:{type:"string"},
        deliverable:{type:"string"},
        pricing:{type:"string"},
        acquisition:{type:"string"},
        firstPaidTest:{type:"string"},
        expectedCosts:{type:"string"},
        risks:{type:"string"},
        successMetric:{type:"string"}
      },
      required:["offer","idealCustomer","problemSolved","deliverable","pricing","acquisition","firstPaidTest","expectedCosts","risks","successMetric"]
    };

    const prompt=[
      "You are the monetization strategist inside an autonomous business agent.",
      "Turn the validated opportunity below into a realistic zero/low-capital first paid test.",
      "Do not assume customers exist, do not promise revenue, and do not invent evidence.",
      "The plan must be simple enough to test quickly. Acquisition can use public business websites/directories, but contacting a business is consequential and must wait for owner approval.",
      "Return one concrete offer, a narrow ideal customer, deliverable, pricing hypothesis, acquisition method, first paid test, expected costs, risks, and a measurable success condition.",
      "",
      "OPPORTUNITY:", JSON.stringify(opportunity),
      "VERIFICATION:", JSON.stringify(state)
    ].join("\n");

    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({
        model, store:false, input:prompt,
        text:{format:{type:"json_schema",name:"monetization_plan",strict:true,schema}}
      }),
      cache:"no-store"
    });
    if(!response.ok) {
      const raw=await response.text();
      return NextResponse.json({ok:false,error:"Monetization brain failed: "+raw.slice(0,600)},{status:502});
    }
    const data=await response.json().catch(()=>null);
    let plan:any;
    try { plan=JSON.parse(String(data?.output_text||"")); } catch { throw new Error("Central brain returned an invalid monetization plan."); }

    const notes=Object.entries(plan).map(([k,v])=>k+": "+String(v)).join("\n");
    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"MONETIZATION_PLAN",
        claim:"Agent-created first paid test plan for "+String(opportunity.name||"opportunity"),
        source:"Central business brain",
        checked_on:new Date().toISOString().slice(0,10),
        quality:"CHECKED",
        notes
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const tasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&status=eq.READY&select=*");
    const planTask=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("build monetization plan")):null;
    if(planTask?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(planTask.id),{
      method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
    });

    const taskId="research-"+opportunityId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-outreach";
    const existing=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.id||"")===taskId):null;
    if(!existing) {
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({id:taskId,title:"Prepare outreach pack: "+String(opportunity.name||"opportunity"),status:"READY",opportunity_id:opportunityId}),
        headers:{"Prefer":"return=minimal"}
      });
    }

    const approvalId="approval-"+taskId;
    const approvals=await supabaseRequest("approvals?id=eq."+encodeURIComponent(approvalId)+"&select=*");
    if(!Array.isArray(approvals)||approvals.length===0) {
      await supabaseRequest("approvals",{
        method:"POST",
        body:JSON.stringify({
          id:approvalId,
          title:"Approve monetization test: "+String(opportunity.name||"opportunity"),
          tier:"T1",
          status:"PENDING"
        }),
        headers:{"Prefer":"return=minimal"}
      });
    }

    return NextResponse.json({ok:true,opportunityId,plan,approvalId,nextTask:taskId});
  } catch(error) {
    return NextResponse.json({ok:false,error:errorText(error,"Monetization planning failed.")},{status:500});
  }
}
