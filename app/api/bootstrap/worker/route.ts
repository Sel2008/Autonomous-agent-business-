import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";
import { BOOTSTRAP_PROVIDERS } from "../../../../lib/bootstrap/providers";
import { adapterFor } from "../../../../lib/bootstrap/execution";
import type { BootstrapOpportunity } from "../../../../lib/bootstrap/types";
import { verifyOpportunity, applyVerification } from "../../../../lib/bootstrap/verification";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Reserve confirmed ZAR account balances against queued business funding requests.
 * A FUNDED request is an internal reservation, not a transfer or proof that money
 * has been spent. Non-ZAR accounts are deliberately excluded to avoid unsafe FX math.
 */
async function ensureFundingResumeApproval(request:any) {
  const opportunityId=String(request?.opportunity_id||"");
  const requestId=String(request?.id||"");
  if(!opportunityId || !requestId) return null;
  const opportunities=await supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=id,name,status");
  const opportunity=Array.isArray(opportunities)?opportunities[0]:null;
  if(!opportunity || String(opportunity.status||"")!=="QUEUED_CAPITAL") return null;
  const title="Approve funded opportunity resumption: "+String(opportunity.name||opportunityId)+" [opportunity:"+opportunityId+"] [funding-request:"+requestId+"]";
  const existing=await supabaseRequest("approvals?title=eq."+encodeURIComponent(title)+"&order=created_at.desc&limit=1&select=*").catch(()=>[]);
  if(Array.isArray(existing) && existing[0]) return existing[0];
  const created=await supabaseRequest("approvals",{
    method:"POST",
    body:JSON.stringify({title,tier:"T1",status:"PENDING",reason:"Confirmed ZAR capital is reserved. Approval permits the Business Brain to resume planning/preparation only; it does not authorize spending, transfers, or outreach sending."}),
    headers:{"Prefer":"return=representation"}
  });
  return Array.isArray(created)?created[0]||null:null;
}

async function resumeApprovedFundedOpportunities(reservationReconciliation:any) {
  if(!reservationReconciliation?.reservationReady) {
    return {resumedOpportunityIds:[],waitingOpportunityIds:[],note:"Resumption is paused until atomic funding reservation is available."};
  }
  const [accountsForResume,allFundedResult]=await Promise.all([
    supabaseRequest("capital_accounts?select=*").catch(()=>[]),
    supabaseRequest("funding_requests?status=eq.FUNDED&order=created_at.asc&select=*").catch(()=>[])
  ]);
  const confirmedBalance=(Array.isArray(accountsForResume)?accountsForResume:[])
    .filter((account:any)=>String(account?.currency||"ZAR").toUpperCase()==="ZAR"&&account?.connected===true&&account?.owner_approved===true)
    .reduce((sum:number,account:any)=>{const n=Number(account?.balance);return sum+(Number.isFinite(n)&&n>0?n:0);},0);
  const totalReserved=(Array.isArray(allFundedResult)?allFundedResult:[])
    .filter((request:any)=>String(request?.currency||"ZAR").toUpperCase()==="ZAR")
    .reduce((sum:number,request:any)=>{const n=Number(request?.requested_amount);return sum+(Number.isFinite(n)&&n>0?n:0);},0);
  if(totalReserved>confirmedBalance) {
    return {resumedOpportunityIds:[],waitingOpportunityIds:[],note:"Resumption is paused because currently confirmed, owner-approved ZAR balances do not cover all existing reservations."};
  }
  const requestsResult=await supabaseRequest("funding_requests?status=eq.FUNDED&order=created_at.asc&select=*").catch(()=>[]);
  const requests=Array.isArray(requestsResult)?requestsResult:[];
  const resumed:string[]=[];
  const waiting:string[]=[];
  for(const request of requests) {
    const opportunityId=String(request?.opportunity_id||"");
    const requestId=String(request?.id||"");
    if(!opportunityId || !requestId) continue;
    const titlePrefix="Approve funded opportunity resumption:";
    const approvals=await supabaseRequest("approvals?title=like."+encodeURIComponent(titlePrefix+"%[opportunity:"+opportunityId+"] [funding-request:"+requestId+"]")+"&order=created_at.desc&limit=1&select=*").catch(()=>[]);
    // PostgREST LIKE patterns and URL encoding differ across deployments; fall back
    // to listing recent approvals and exact matching the stable request marker.
    let approval=Array.isArray(approvals)?approvals.find((a:any)=>String(a?.title||"").includes("[funding-request:"+requestId+"]")):null;
    if(!approval) {
      const recent=await supabaseRequest("approvals?order=created_at.desc&limit=200&select=*").catch(()=>[]);
      approval=Array.isArray(recent)?recent.find((a:any)=>String(a?.title||"").startsWith(titlePrefix) && String(a?.title||"").includes("[funding-request:"+requestId+"]")):null;
    }
    if(!approval || String(approval.status||"")!=="APPROVED") {
      await ensureFundingResumeApproval(request);
      waiting.push(opportunityId);
      continue;
    }

    const opportunities=await supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId)+"&select=*").catch(()=>[]);
    const op=Array.isArray(opportunities)?opportunities[0]:null;
    if(!op || String(op.status||"")!=="QUEUED_CAPITAL") continue;
    const verificationRows=await supabaseRequest("opportunity_verification?opportunity_id=eq."+encodeURIComponent(opportunityId)+"&select=*").catch(()=>[]);
    const verification=Array.isArray(verificationRows)?verificationRows:[];
    const fullyVerified=["demand","access","margin","repeatability","risk"].every((key)=>{
      const values=verification.map((v:any)=>String(v?.[key]||"UNVERIFIED"));
      return values.includes("CHECKED") || values.includes("STRONG");
    });
    if(!fullyVerified) {
      waiting.push(opportunityId);
      continue;
    }
    const selected=await supabaseRequest("opportunities?status=eq.SELECTED&select=id&limit=1").catch(()=>[]);
    if(Array.isArray(selected) && selected.some((row:any)=>String(row?.id||"")!==opportunityId)) {
      waiting.push(opportunityId);
      continue;
    }

    await supabaseRequest("opportunities?id=eq."+encodeURIComponent(opportunityId),{
      method:"PATCH",
      body:JSON.stringify({
        status:"SELECTED",
        next_action:"Confirmed capital is reserved and the owner approved resumption. Continue with non-sending preparation; any spending or outreach sending still requires its own safeguards."
      }),
      headers:{"Prefer":"return=minimal"}
    });
    resumed.push(opportunityId);
  }
  return {resumedOpportunityIds:resumed,waitingOpportunityIds:[...new Set(waiting)],note:"Resumption only restores the selected workflow after an explicit owner approval and full verification. It does not spend funds or send outreach."};
}

async function reconcileFundingRequests() {
  // Reservation must be atomic in Postgres. If the migration is not installed,
  // fail closed for new reservations rather than risk allocating the same balance twice.
  let atomicResult:any=null;
  let reservationError="";
  try {
    atomicResult=await supabaseRequest("rpc/reserve_queued_funding_requests",{
      method:"POST",
      body:JSON.stringify({}),
      headers:{"Prefer":"return=representation"}
    });
  } catch(error) {
    reservationError=readableError(error,"Atomic funding reservation RPC is unavailable.");
  }
  if(!reservationError && (!atomicResult || typeof atomicResult!=="object" || Array.isArray(atomicResult) || !Number.isFinite(Number(atomicResult.availableZar)))) {
    reservationError="Atomic funding reservation RPC returned an unexpected result.";
  }

  const [accountsResult,requestsResult]=await Promise.all([
    supabaseRequest("capital_accounts?select=*").catch(()=>[]),
    supabaseRequest("funding_requests?status=in.(QUEUED,FUNDED)&order=created_at.asc&select=*").catch(()=>[])
  ]);
  const accounts=Array.isArray(accountsResult)?accountsResult:[];
  const requests=Array.isArray(requestsResult)?requestsResult:[];
  const availableZar=accounts
    .filter((account:any)=>String(account?.currency||"ZAR").toUpperCase()==="ZAR"&&account?.connected===true&&account?.owner_approved===true)
    .reduce((sum:number,account:any)=>{
      const balance=Number(account?.balance);
      return sum+(Number.isFinite(balance)&&balance>0?balance:0);
    },0);
  const currentReserved=requests
    .filter((request:any)=>String(request?.status||"")==="FUNDED"&&String(request?.currency||"ZAR").toUpperCase()==="ZAR")
    .reduce((sum:number,request:any)=>{
      const amount=Number(request?.requested_amount);
      return sum+(Number.isFinite(amount)&&amount>0?amount:0);
    },0);

  for(const request of requests.filter((item:any)=>String(item?.status||"")==="FUNDED")) {
    await ensureFundingResumeApproval(request).catch(()=>null);
  }

  const result=atomicResult&&typeof atomicResult==="object"&&!Array.isArray(atomicResult)
    ? atomicResult
    : {};
  return {
    availableZar:Number(result.availableZar??availableZar),
    reservedZar:Number(result.reservedZar??currentReserved),
    newlyReservedRequests:Array.isArray(result.newlyReservedRequests)?result.newlyReservedRequests:[],
    reservationReady:!reservationError,
    ...(reservationError?{reservationError}:{}),
    note:reservationError
      ?"New capital reservations are paused because the atomic database reservation migration is not available. Existing funded requests remain visible; no unsafe fallback reservation was attempted."
      :"Reservations were serialized in the database. FUNDED means internal reservation only; it does not transfer or spend money."
  };
}

function readableError(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok:false, error:"Bootstrap worker is not authorized." }, { status:401 });
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ ok:false, error:"Supabase is not configured." }, { status:503 });
  }

  try {
    const fundingReconciliation = await reconcileFundingRequests();
    const fundingResumption = await resumeApprovedFundedOpportunities(fundingReconciliation);
    const discovered:any[] = [];
    const discoveryErrors:string[] = [];

    // Refresh the funding opportunity pool. This is deliberately independent
    // from the business brain's single-winner selection flow.
    for (const provider of BOOTSTRAP_PROVIDERS) {
      try {
        const found = await provider.discover();
        for (const item of found) {
          const row = (await import("../../../../lib/bootstrap/discovery")).opportunityRow(item);
          await supabaseRequest("bootstrap_opportunities?on_conflict=id", {
            method:"POST",
            body:JSON.stringify(row),
            headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}
          });
          discovered.push(row);
        }
      } catch (error) {
        discoveryErrors.push(`${provider.id}: ${readableError(error,"provider discovery failed")}`);
      }
    }

    // Verify every currently discovered candidate, not just one selected winner.
    const candidates = await supabaseRequest(
      "bootstrap_opportunities?status=eq.DISCOVERED&order=created_at.asc&select=*"
    );
    const verified:string[] = [];
    const verificationErrors:any[] = [];

    for (const op of Array.isArray(candidates) ? candidates : []) {
      try {
        const result = await verifyOpportunity(op);
        if (result.ok === false) {
          verificationErrors.push({id:op.id,error:result.error});
          continue;
        }
        const patch = applyVerification(op,result.verification);
        await supabaseRequest("bootstrap_opportunities?id=eq." + encodeURIComponent(String(op.id)), {
          method:"PATCH",
          body:JSON.stringify(patch),
          headers:{"Prefer":"return=minimal"}
        });
        verified.push(String(op.id));
      } catch (error) {
        verificationErrors.push({id:op.id,error:readableError(error,"verification failed")});
      }
    }

    // Queue one durable work record for every autonomous-ready opportunity.
    // We do not mark work complete here: a provider execution adapter must
    // supply a real external task/result before money enters the capital ledger.
    const ready = await supabaseRequest(
      "bootstrap_opportunities?status=eq.READY&select=*"
    );
    const queued:string[] = [];

    const taskQueueErrors:any[] = [];
    for (const op of Array.isArray(ready) ? ready : []) {
      // The database RPC takes a per-opportunity lock so overlapping heartbeat
      // runs cannot create duplicate task slots for the same candidate.
      try {
        const queuedTask=await supabaseRequest("rpc/ensure_bootstrap_task_slot",{
          method:"POST",
          body:JSON.stringify({
            p_opportunity_id:String(op.id),
            p_title:String(op.title||"Bootstrap work")+" — provider work slot",
            p_currency:String(op.currency||"ZAR")
          }),
          headers:{"Prefer":"return=representation"}
        });
        const taskInfo=queuedTask&&typeof queuedTask==="object"&&!Array.isArray(queuedTask)?queuedTask:null;
        if(taskInfo?.created===true&&taskInfo?.taskId) queued.push(String(taskInfo.taskId));
      } catch(error) {
        taskQueueErrors.push({opportunityId:String(op.id),error:readableError(error,"Atomic task queue RPC is unavailable.")});
      }
    }

    // Execute only through an explicitly registered provider adapter.
    // Discovery/verification status alone can never trigger external work.
    const executionCandidates = await supabaseRequest(
      "bootstrap_tasks?status=eq.READY&select=*,bootstrap_opportunities(*)&order=created_at.asc"
    ).catch(()=>[]);
    const executionResults:any[] = [];

    for (const task of Array.isArray(executionCandidates) ? executionCandidates : []) {
      const op = task?.bootstrap_opportunities as BootstrapOpportunity | undefined;
      if (!op) continue;

      const adapter = adapterFor(op);
      if (!adapter || !op.automation_allowed || op.status !== "READY") {
        executionResults.push({
          taskId:String(task.id),
          status:"NOT_EXECUTED",
          reason: !adapter
            ? "No explicit provider execution adapter is installed."
            : !op.automation_allowed
              ? "Provider automation permission is not verified."
              : "Opportunity is not autonomous-ready."
        });
        continue;
      }

      try {
        // Claim atomically in Postgres before calling the external provider.
        // If another heartbeat already claimed this task, do not execute it again.
        const claim = await supabaseRequest("rpc/claim_bootstrap_task", {
          method:"POST",
          body:JSON.stringify({p_task_id:String(task.id)}),
          headers:{"Prefer":"return=representation"}
        });
        if (!claim || typeof claim !== "object" || Array.isArray(claim) || claim.claimed !== true) {
          executionResults.push({
            taskId:String(task.id),
            status:"NOT_EXECUTED",
            reason:String(claim?.reason || "Task was already claimed by another worker.")
          });
          continue;
        }

        const result = await adapter.execute(op);

        if ("reason" in result) {
          const blockedStatus = result.status==="BLOCKED" ? "BLOCKED" : "FAILED";
          await supabaseRequest("bootstrap_tasks?id=eq."+encodeURIComponent(String(task.id)), {
            method:"PATCH",
            body:JSON.stringify({status:blockedStatus,notes:result.reason}),
            headers:{"Prefer":"return=minimal"}
          });
          executionResults.push({taskId:String(task.id),status:result.status,reason:result.reason});
          continue;
        }

        const nextStatus = result.status==="PENDING_PAYOUT" ? "PENDING_PAYOUT" : result.status==="SUBMITTED" ? "SUBMITTED" : "IN_PROGRESS";
        await supabaseRequest("bootstrap_tasks?id=eq."+encodeURIComponent(String(task.id)), {
          method:"PATCH",
          body:JSON.stringify({
            status:nextStatus,
            external_task_id:result.externalTaskId || String(task.external_task_id||""),
            ...(typeof result.grossAmount==="number" ? {gross_amount:result.grossAmount} : {}),
            ...(result.currency ? {currency:result.currency} : {}),
            notes:result.notes || ""
          }),
          headers:{"Prefer":"return=minimal"}
        });
        executionResults.push({taskId:String(task.id),status:result.status,externalTaskId:result.externalTaskId||null});
      } catch (error) {
        await supabaseRequest("bootstrap_tasks?id=eq."+encodeURIComponent(String(task.id)), {
          method:"PATCH",
          body:JSON.stringify({status:"FAILED",notes:readableError(error,"Provider execution failed.")}),
          headers:{"Prefer":"return=minimal"}
        }).catch(()=>{});
        executionResults.push({taskId:String(task.id),status:"FAILED",reason:readableError(error,"Provider execution failed.")});
      }
    }

    // Earnings are recorded only from an explicit PAID task. A provider adapter
    // must first establish the real external payout before this ledger entry.
    const paidTasks = await supabaseRequest(
      "bootstrap_tasks?status=eq.PAID&payout_status=eq.PAID&select=*"
    ).catch(()=>[]);
    let earningsRecorded=0;

    for (const task of Array.isArray(paidTasks) ? paidTasks : []) {
      // The database RPC serializes ledger writes per task. A read-then-insert
      // check here would double-credit if two heartbeats processed the same payout.
      try {
        const recorded = await supabaseRequest("rpc/record_bootstrap_paid_earning", {
          method:"POST",
          body:JSON.stringify({p_task_id:String(task.id)}),
          headers:{"Prefer":"return=representation"}
        });
        if (recorded && typeof recorded === "object" && !Array.isArray(recorded) && recorded.recorded === true) {
          earningsRecorded += 1;
        }
      } catch (error) {
        // Fail closed: a missing migration or ledger error must never trigger a
        // non-atomic fallback insert from application code.
        taskQueueErrors.push({
          opportunityId:String(task.opportunity_id||""),
          taskId:String(task.id),
          error:"Paid earning was not recorded; atomic ledger RPC failed: "+readableError(error,"unknown error")
        });
      }
    }

    const manual = await supabaseRequest(
      "bootstrap_opportunities?status=eq.VERIFIED&select=id,title,provider"
    ).catch(()=>[]);

    return NextResponse.json({
      ok:true,
      worker:"bootstrap-funding-heartbeat",
      fundingReconciliation,
      fundingResumption,
      discovered:discovered.length,
      verified:verified.length,
      queued:queued.length,
      queuedTaskIds:queued,
      manualOnly:Array.isArray(manual) ? manual.length : 0,
      discoveryErrors,
      verificationErrors,
      taskQueueErrors,
      execution:{
        autonomousReadyQueued:queued.length,
        tasksAttempted:executionResults.filter(x=>["IN_PROGRESS","SUBMITTED","PENDING_PAYOUT"].includes(String(x.status))).length,
        earningsRecorded,
        results:executionResults,
        note:"Only explicitly registered provider adapters can execute work. Earnings enter the capital ledger only after a real task reaches PAID/PENDING payout confirmation."
      }
    });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      worker:"bootstrap-funding-heartbeat",
      error:readableError(error,"Bootstrap funding worker failed.")
    },{status:500});
  }
}

export async function GET(req: Request) {
  return POST(req);
}
