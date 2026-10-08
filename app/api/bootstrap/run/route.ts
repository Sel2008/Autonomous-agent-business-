import { NextResponse } from "next/server";
import { supabaseConfigured,supabaseRequest } from "../../../../lib/supabase";

export async function POST(){
  if(!supabaseConfigured()) return NextResponse.json({ok:false,error:"Supabase is not configured."},{status:503});
  const rows=await supabaseRequest("bootstrap_opportunities?select=*&order=created_at.asc");
  const candidates=(Array.isArray(rows)?rows:[]).filter((x:any)=>String(x.status)==="DISCOVERED");
  const verified:any[]=[];
  for(const op of candidates.slice(0,10)){
    const r=await fetch(new URL("/api/bootstrap/verify",process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3000"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:op.id})}).catch(()=>null);
    if(r?.ok) verified.push(op.id);
  }
  return NextResponse.json({ok:true,verified:verified.length,mode:"DISCOVERY_AND_VERIFICATION_ONLY"});
}
