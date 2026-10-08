import { NextResponse } from "next/server";
import { supabaseConfigured,supabaseRequest } from "../../../../lib/supabase";
import { verifyOpportunity,applyVerification } from "../../../../lib/bootstrap/verification";

export async function POST(req:Request){
  if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
  try{
    const body=await req.json().catch(()=>({}));
    const id=String(body?.id||"").trim();
    if(!id) return NextResponse.json({ok:false,error:"id is required."},{status:400});
    const rows=await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(id)+"&select=*");
    const op=Array.isArray(rows)?rows[0]:null;
    if(!op) return NextResponse.json({ok:false,error:"Bootstrap opportunity not found."},{status:404});
    const result=await verifyOpportunity(op);
    if(!result.ok) return NextResponse.json(result,{status:503});
    const patch=applyVerification(op,result.verification);
    const saved=await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(patch)});
    return NextResponse.json({ok:true,opportunity:saved,verification:result.verification});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Bootstrap verification failed."},{status:500});
  }
}
