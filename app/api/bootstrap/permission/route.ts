import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

const PREFIX = "Bootstrap permission review";

function fail(message:string,status=400){
  return NextResponse.json({ok:false,error:message},{status});
}

export async function POST(req:Request){
  if(!supabaseConfigured()) return fail("Supabase is not configured.",503);
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"");
    if(action==="request"){
      const opportunityId=String(body?.opportunityId||"").trim();
      if(!opportunityId) return fail("opportunityId is required.");
      const rows=await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*");
      const op=Array.isArray(rows)?rows[0]:null;
      if(!op) return fail("Bootstrap opportunity not found.",404);
      if(String(op.status)==="BLOCKED" || String(op.risk_status)==="BLOCKED"){
        return fail("This opportunity is blocked by a safety or provider-rule finding. An owner approval cannot override that block.",409);
      }
      if(op.automation_allowed===true){
        return fail("Automation permission is already marked verified. A separate provider adapter is still required before execution.",409);
      }
      const title=PREFIX+": "+String(op.provider||"Unknown provider")+" — "+String(op.title||"Untitled task")+" [opportunity:"+opportunityId+"]";
      const existing=await supabaseRequest("approvals?title=eq."+encodeURIComponent(title)+"&status=eq.PENDING&order=created_at.desc&limit=1&select=*");
      if(Array.isArray(existing)&&existing[0]) return NextResponse.json({ok:true,approval:existing[0],existing:true});
      const created=await supabaseRequest("approvals",{
        method:"POST",
        body:JSON.stringify({title,tier:"T2",status:"PENDING"}),
        headers:{"Prefer":"return=representation"}
      });
      const approval=Array.isArray(created)?created[0]:null;
      if(!approval?.id) throw new Error("Approval request was not returned by the database.");
      return NextResponse.json({ok:true,approval,existing:false});
    }

    if(action==="decide"){
      const approvalId=String(body?.approvalId||"").trim();
      const decision=String(body?.decision||"");
      if(!approvalId || !["APPROVED","REJECTED"].includes(decision)) return fail("A valid approvalId and APPROVED/REJECTED decision are required.");
      const found=await supabaseRequest("approvals?id=eq."+encodeURIComponent(approvalId)+"&select=*");
      const approval=Array.isArray(found)?found[0]:null;
      if(!approval) return fail("Approval request not found.",404);
      const title=String(approval.title||"");
      if(!title.startsWith(PREFIX+": ") || !title.includes("[opportunity:")) return fail("This is not a bootstrap permission request.",403);
      if(String(approval.status)!=="PENDING") return fail("This request has already been decided.",409);
      const match=title.match(/\[opportunity:([^\]]+)\]$/);
      const opportunityId=match?.[1];
      if(!opportunityId) return fail("The request is missing its opportunity reference.",400);
      const opRows=await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*");
      const op=Array.isArray(opRows)?opRows[0]:null;
      if(!op) return fail("The linked opportunity no longer exists.",404);
      if(String(op.status)==="BLOCKED" || String(op.risk_status)==="BLOCKED") return fail("This opportunity is blocked. The decision cannot override its safety block.",409);

      const saved=await supabaseRequest("approvals?id=eq."+encodeURIComponent(approvalId),{
        method:"PATCH",
        body:JSON.stringify({status:decision,decided_at:new Date().toISOString()}),
        headers:{"Prefer":"return=representation"}
      });
      const note=decision==="APPROVED"
        ? "Owner decision: APPROVED supervised permission/capability review on "+new Date().toISOString()+". This is not proof that the provider permits automation; automation_allowed remains false until explicit provider evidence is verified, and execution remains disabled without a registered adapter."
        : "Owner decision: REJECTED automated permission/capability review on "+new Date().toISOString()+". Keep this opportunity paused for automated execution; manual work may be considered separately if provider rules allow it.";
      const oldNotes=String(op.notes||"");
      await supabaseRequest("bootstrap_opportunities?id=eq."+encodeURIComponent(opportunityId),{
        method:"PATCH",
        body:JSON.stringify({
          notes:(oldNotes?oldNotes+"\n\n":"")+note,
          ...(decision==="REJECTED"?{status:"PAUSED"}:{})
        }),
        headers:{"Prefer":"return=minimal"}
      });
      return NextResponse.json({ok:true,decision,approval:Array.isArray(saved)?saved[0]||null:null,opportunityId,automationEnabled:false});
    }
    return fail("Unknown action. Use request or decide.");
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Bootstrap permission request failed."},{status:500});
  }
}
