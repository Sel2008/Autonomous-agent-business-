import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

export async function POST(req: Request) {
  try {
    const secret=process.env.RESULT_WEBHOOK_SECRET;
    if(!secret || req.headers.get("authorization")!==`Bearer ${secret}`) {
      return NextResponse.json({ok:false,error:"Result webhook is not authorized."},{status:401});
    }
    if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});

    const body=await req.json().catch(()=>({}));
    const opportunityId=String(body?.opportunityId||"").trim();
    const amount=Number(body?.amount);
    const currency=String(body?.currency||"R").trim().slice(0,8);
    const status=String(body?.status||"PAID").trim().toUpperCase();
    if(!opportunityId || !Number.isFinite(amount) || amount<0) {
      return NextResponse.json({ok:false,error:"opportunityId and a non-negative numeric amount are required."},{status:400});
    }

    const claim=status==="PAID"||status==="COMPLETED"
      ? `Verified business result: ${currency} ${amount.toFixed(2)} received`
      : `Business result recorded: ${status} ${currency} ${amount.toFixed(2)}`;

    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,
        type:"BUSINESS_RESULT",
        claim,
        source:String(body?.source||"Connected result provider"),
        checked_on:new Date().toISOString().slice(0,10),
        quality:"STRONG",
        notes:JSON.stringify({
          amount,currency,status,
          externalReference:String(body?.externalReference||""),
          occurredAt:String(body?.occurredAt||new Date().toISOString()),
          notes:String(body?.notes||"")
        })
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const taskId="research-"+opportunityId.replace(/[^a-zA-Z0-9_-]/g,"-")+"-learn";
    const existing=await supabaseRequest("tasks?id=eq."+encodeURIComponent(taskId)+"&select=*");
    if(!Array.isArray(existing)||existing.length===0){
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({id:taskId,title:"Learn from business result: "+opportunityId,status:"READY",opportunity_id:opportunityId}),
        headers:{"Prefer":"return=minimal"}
      });
    }

    return NextResponse.json({ok:true,opportunityId,amount,currency,status,learningTask:taskId});
  } catch(error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Result recording failed."},{status:500});
  }
}
