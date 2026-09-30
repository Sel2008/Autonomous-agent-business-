import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

export async function POST(req: Request) {
  try {
    if (!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
    const body=await req.json().catch(()=>({}));
    const opportunityId=String(body?.opportunityId||"").trim();
    if(!opportunityId) return NextResponse.json({ok:false,error:"opportunityId is required."},{status:400});

    const sendTaskId="research-"+opportunityId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-send";
    const approvalId="approval-"+sendTaskId;
    const approvals=await supabaseRequest("approvals?id=eq."+encodeURIComponent(approvalId)+"&select=*");
    const approved=Array.isArray(approvals)?approvals.find((a:any)=>a?.status==="APPROVED"):null;
    if(!approved) return NextResponse.json({ok:false,error:"Owner approval is required before outreach can be sent."},{status:403});

    const webhook=process.env.OUTREACH_WEBHOOK_URL;
    if(!webhook){
      return NextResponse.json({
        ok:false,
        blocked:true,
        error:"Owner approval is present, but no OUTREACH_WEBHOOK_URL is configured. The outreach pack remains ready for manual sending or a connected sending provider."
      },{status:503});
    }

    const evidence=await supabaseRequest("evidence?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&type=eq.OUTREACH_PACK&order=created_at.desc&limit=1&select=*");
    const pack=Array.isArray(evidence)?evidence[0]:null;
    if(!pack) return NextResponse.json({ok:false,error:"No outreach pack is available to send."},{status:404});

    const response=await fetch(webhook,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(process.env.OUTREACH_WEBHOOK_SECRET?{"Authorization":"Bearer "+process.env.OUTREACH_WEBHOOK_SECRET}:{})
      },
      body:JSON.stringify({
        opportunityId,
        approvalId:approved.id,
        claim:pack.claim,
        notes:pack.notes,
        sentAt:new Date().toISOString()
      }),
      cache:"no-store"
    });
    if(!response.ok) return NextResponse.json({ok:false,error:"Outreach provider rejected the send request: "+response.status},{status:502});

    const tasks=await supabaseRequest("tasks?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&status=eq.READY&select=*");
    const sendTask=Array.isArray(tasks)?tasks.find((t:any)=>String(t?.title||"").toLowerCase().includes("send approved outreach")):null;
    if(sendTask?.id) await supabaseRequest("tasks?id=eq."+encodeURIComponent(sendTask.id),{
      method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
    });

    return NextResponse.json({ok:true,opportunityId,sent:true,taskCompleted:Boolean(sendTask?.id)});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Outreach execution failed."},{status:500});
  }
}
