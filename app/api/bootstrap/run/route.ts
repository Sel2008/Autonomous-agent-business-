import { NextResponse } from "next/server";
import { supabaseConfigured,supabaseRequest } from "../../../../lib/supabase";
import { verifyOpportunity,applyVerification } from "../../../../lib/bootstrap/verification";

export async function POST(){
  if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
  try{
    const rows=await supabaseRequest("bootstrap_opportunities?select=*&order=created_at.asc");
    const candidates=(Array.isArray(rows)?rows:[]).filter((x:any)=>String(x.status)==="DISCOVERED").slice(0,10);
    const verified:string[]=[];
    const failed:any[]=[];
    for(const op of candidates){
      const result=await verifyOpportunity(op);
      if(!result.ok){failed.push({id:op.id,error:result.error});continue;}
      const patch=applyVerification(op,result.verification);
      await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(String(op.id)),{
        method:"PATCH",body:JSON.stringify(patch),headers:{"Prefer":"return=minimal"}
      });
      verified.push(String(op.id));
    }
    return NextResponse.json({ok:true,verified:verified.length,failed,mode:"DISCOVERY_AND_VERIFICATION_ONLY"});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Bootstrap verification run failed."},{status:500});
  }
}
