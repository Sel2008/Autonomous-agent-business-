import { NextResponse } from "next/server";
import { supabaseConfigured,supabaseRequest } from "../../../../lib/supabase";
import { BOOTSTRAP_PROVIDERS } from "../../../../lib/bootstrap/providers";
import { opportunityRow } from "../../../../lib/bootstrap/discovery";

export async function POST(){
  if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
  try{
    const out:any[]=[];
    for(const provider of BOOTSTRAP_PROVIDERS){
      const found=await provider.discover();
      for(const item of found){
        const row=opportunityRow(item);
        await supabaseRequest("bootstrap_opportunities?on_conflict=id",{
          method:"POST",body:JSON.stringify(row),headers:{"Prefer":"resolution=merge-duplicates,return=representation"}
        });
        out.push({...row,providerSource:provider.id});
      }
    }
    return NextResponse.json({ok:true,discovered:out.length,opportunities:out});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Bootstrap discovery failed."},{status:500});
  }
}
