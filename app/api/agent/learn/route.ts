import { NextResponse } from "next/server";
import { runBusinessAIWithDiagnostics } from "../../../../lib/ai-router";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

export async function POST(req: Request) {
  try {
    if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
    const body=await req.json().catch(()=>({}));
    const opportunityId=String(body?.opportunityId||"").trim();
    if(!opportunityId) return NextResponse.json({ok:false,error:"opportunityId is required."},{status:400});

    const [opportunities,results]=await Promise.all([
      supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*"),
      supabaseRequest("evidence?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&type=eq.BUSINESS_RESULT&order=created_at.desc&select=*")
    ]);
    const opportunity=Array.isArray(opportunities)?opportunities[0]:null;
    const resultRows=Array.isArray(results)?results:[];
    if(!opportunity||resultRows.length===0) return NextResponse.json({ok:false,error:"No business result is available to learn from."},{status:404});

    const schema={
      type:"object",additionalProperties:false,
      properties:{
        observed:{type:"string"},keep:{type:"string"},change:{type:"string"},
        stop:{type:"string"},nextExperiment:{type:"string"}
      },
      required:["observed","keep","change","stop","nextExperiment"]
    };
    const prompt=[
      "You are the learning component of an autonomous business agent.",
      "Analyze recorded business outcomes and state what should be repeated, changed, or stopped.",
      "Do not invent causes. Separate observed outcomes from hypotheses. Recommend one next experiment.",
      "Opportunity: "+JSON.stringify(opportunity),
      "Results: "+JSON.stringify(resultRows)
    ].join("\n");
    const routed=await runBusinessAIWithDiagnostics({prompt,schema});
    if(!routed.result) {
      return NextResponse.json({
        ok:false,
        error:"No configured AI provider completed the learning step.",
        diagnostics:routed.diagnostics
      },{status:503});
    }
    let learning:any;
    try { learning=JSON.parse(routed.result.text); }
    catch {
      return NextResponse.json({ok:false,error:"The learning provider returned invalid structured output.",provider:routed.result.provider},{status:502});
    }
    if(!learning || ["observed","keep","change","stop","nextExperiment"].some((key)=>typeof learning[key]!=="string")) {
      return NextResponse.json({ok:false,error:"The learning provider response was missing required fields.",provider:routed.result.provider},{status:502});
    }

    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"LEARNING",
        claim:"Agent learning from recorded business result",
        source:"Central business brain ("+routed.result.provider+" / "+routed.result.model+")",
        checked_on:new Date().toISOString().slice(0,10),
        quality:"CHECKED",
        notes:Object.entries(learning).map(([k,v])=>k+": "+String(v)).join("\n")
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const tasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&status=eq.READY&select=*");
    const task=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("learn from business result")):null;
    if(task?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(task.id),{
      method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
    });

    return NextResponse.json({ok:true,opportunityId,learning});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Learning failed."},{status:500});
  }
}
