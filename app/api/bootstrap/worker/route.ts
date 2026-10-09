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

async function resumeApprovedFundedOpportunities() {
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
  const [accountsResult, requestsResult] = await Promise.all([
    supabaseRequest("capital_accounts?select=*").catch(() => []),
    supabaseRequest("funding_requests?status=in.(QUEUED,FUNDED)&order=created_at.asc&select=*").catch(() => [])
  ]);
  const accounts = Array.isArray(accountsResult) ? accountsResult : [];
  const requests = Array.isArray(requestsResult) ? requestsResult : [];
  const availableZar = accounts
    .filter((account:any) => String(account?.currency || "ZAR").toUpperCase() === "ZAR")
    .reduce((sum:number, account:any) => {
      const balance = Number(account?.balance);
      return sum + (Number.isFinite(balance) && balance > 0 ? balance : 0);
    }, 0);

  // Existing reservations consume available funds first, preventing two queued
  // opportunities from claiming the same balance on later heartbeat runs.
  let reserved = requests
    .filter((request:any) => String(request?.status || "") === "FUNDED" && String(request?.currency || "ZAR").toUpperCase() === "ZAR")
    .reduce((sum:number, request:any) => {
      const amount = Number(request?.requested_amount);
      return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);

  const newlyFunded:string[] = [];
  for (const request of requests) {
    if (String(request?.status || "") !== "QUEUED") continue;
    if (String(request?.currency || "ZAR").toUpperCase() !== "ZAR") continue;
    const amount = Number(request?.requested_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (reserved + amount > availableZar) continue;

    const id = String(request?.id || "");
    if (!id) continue;
    await supabaseRequest("funding_requests?id=eq." + encodeURIComponent(id), {
      method:"PATCH",
      body:JSON.stringify({
        status:"FUNDED",
        reason:String(request?.reason || "") + " [Capital reserved from confirmed ZAR account balance; no transfer or spend performed.]"
      }),
      headers:{"Prefer":"return=minimal"}
    });
    reserved += amount;
    newlyFunded.push(id);
  }

  for(const request of requests.filter((item:any)=>String(item?.status||"")==="FUNDED")) {
    await ensureFundingResumeApproval(request).catch(()=>null);
  }

  return {
    availableZar,
    reservedZar:reserved,
    newlyReservedRequests:newlyFunded,
    note:"FUNDED means internally reserved only. Opportunities remain queued until the separate resume workflow is implemented; no money is moved or spent."
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
    // Recover claims that exceeded the safe stale window. This marks them FAILED
    // for human/provider reconciliation; it deliberately does not retry uncertain work.
    const staleClaimRecovery = await supabaseRequest("rpc/expire_stale_bootstrap_claims", {
      method:"POST",
      body:JSON.stringify({p_stale_minutes:120}),
      headers:{"Prefer":"return=representation"}
    }).catch((error:any) => ({ok:false, expiredCount:0, reason:readableError(error,"Stale claim recovery RPC failed.")}));
    const fundingResumption = await resumeApprovedFundedOpportunities();
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

    for (const op of Array.isArray(ready) ? ready : []) {
      const existing = await supabaseRequest(
        "bootstrap_tasks?opportunity_id=eq." + encodeURIComponent(String(op.id)) +
        "&status=in.(READY,IN_PROGRESS,SUBMITTED,PENDING_PAYOUT)&select=id&limit=1"
      ).catch(()=>[]);

      if (Array.isArray(existing) && existing.length) continue;

      const task = await supabaseRequest("bootstrap_tasks", {
        method:"POST",
        body:JSON.stringify({
          opportunity_id:String(op.id),
          external_task_id:"",
          title:String(op.title || "Bootstrap work") + " — provider work slot",
          status:"READY",
          gross_amount:0,
          fees:0,
          net_amount:0,
          currency:String(op.currency || "ZAR"),
          payout_status:"NOT_STARTED",
          notes:"Queued by the continuous funding worker. Execution requires a provider adapter and explicit automation permission."
        }),
        headers:{"Prefer":"return=representation"}
      });
      if (Array.isArray(task) && task[0]?.id) queued.push(String(task[0].id));
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
        await supabaseRequest("bootstrap_tasks?id=eq."+encodeURIComponent(String(task.id)), {
          method:"PATCH",
          body:JSON.stringify({status:"IN_PROGRESS",started_at:new Date().toISOString()}),
          headers:{"Prefer":"return=minimal"}
        });

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
      const existing = await supabaseRequest(
        "capital_transactions?source_task_id=eq."+encodeURIComponent(String(task.id))+"&kind=eq.EARNING&select=id&limit=1"
      ).catch(()=>[]);
      if (Array.isArray(existing) && existing.length) continue;

      const amount=Number(task.net_amount||0);
      if (!Number.isFinite(amount) || amount<=0) continue;

      await supabaseRequest("capital_transactions", {
        method:"POST",
        body:JSON.stringify({
          kind:"EARNING",
          amount,
          currency:String(task.currency||"ZAR"),
          status:"CONFIRMED",
          reference:String(task.external_task_id||task.id),
          source_task_id:String(task.id),
          notes:"Confirmed bootstrap payout recorded by provider execution adapter."
        }),
        headers:{"Prefer":"return=minimal"}
      });
      earningsRecorded += 1;
    }

    const manual = await supabaseRequest(
      "bootstrap_opportunities?status=eq.VERIFIED&select=id,title,provider"
    ).catch(()=>[]);

    return NextResponse.json({
      ok:true,
      worker:"bootstrap-funding-heartbeat",
      fundingReconciliation,
      staleClaimRecovery,
      fundingResumption,
      discovered:discovered.length,
      verified:verified.length,
      queued:queued.length,
      queuedTaskIds:queued,
      manualOnly:Array.isArray(manual) ? manual.length : 0,
      discoveryErrors,
      verificationErrors,
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
