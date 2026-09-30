import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

export async function POST(req: Request) {
  try {
    if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
    const key=process.env.OPENAI_API_KEY;
    if(!key) return NextResponse.json({ok:false,error:"OPENAI_API_KEY is required for learning."},{status:503});

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

    const model=process.env.OPENAI_MODEL||"gpt-5.6-luna";
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,store:false,
        input:[
          "You are the learning component of an autonomous business agent.",
          "Analyze the recorded business outcomes and state what should be repeated, changed, or stopped.",
          "Do not invent causes. Separate observed outcomes from hypotheses. Recommend one next experiment.",
          "Opportunity: "+JSON.stringify(opportunity),
          "Results: "+JSON.stringify(resultRows)
        ].join("\n"),
        text:{format:{type:"json_schema",name:"business_learning",strict:true,schema:{
          type:"object",additionalProperties:false,
          properties:{observed:{type:"string"},keep:{type:"string"},change:{type:"string"},stop:{type:"string"},nextExperiment:{type:"string"}},
          required:["observed","keep","change","stop","nextExperiment"]
        }}}
      }),
      cache:"no-store"
    });
    if(!response.ok) return NextResponse.json({ok:false,error:"Learning brain failed: "+(await response.text()).slice(0,600)},{status:502});
    const data=await response.json().catch(()=>null);
    const learning=JSON.parse(String(data?.output_text||""));

    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"LEARNING",
        claim:"Agent learning from recorded business result",
        source:"Central business brain",
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
