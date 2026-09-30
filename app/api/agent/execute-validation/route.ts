import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

const DIMENSIONS = ["demand", "access", "margin", "repeatability", "risk"] as const;
type Dimension = typeof DIMENSIONS[number];

function readableError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") { try { return JSON.stringify(value); } catch { return fallback; } }
  return fallback;
}
function label(d: Dimension) { return d === "margin" ? "economics / monetization" : d; }
function quality(resultCount: number, text: string) {
  const lower = text.toLowerCase();
  const concrete = ["price","revenue","demand","market","survey","report","rate","percent","cost"].some(w => lower.includes(w));
  return resultCount >= 3 && concrete ? "STRONG" : "CHECKED";
}

export async function POST(req: Request) {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) return NextResponse.json({ok:false,error:"Research provider is not configured."},{status:503});
  if (!supabaseConfigured()) return NextResponse.json({ok:false,error:"Database is not configured."},{status:503});
  try {
    const body = await req.json();
    const opportunityId = String(body?.opportunityId || "").trim();
    if (!opportunityId) return NextResponse.json({ok:false,error:"An opportunity is required."},{status:400});

    const opportunities = await supabaseRequest(`opportunities?id=eq.${encodeURIComponent(opportunityId)}&select=*`);
    const opportunity = Array.isArray(opportunities) ? opportunities[0] : null;
    if (!opportunity) return NextResponse.json({ok:false,error:"Opportunity not found."},{status:404});

    const verificationRows = await supabaseRequest(`opportunity_verification?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=*`);
    const current = verificationRows?.[0] || {};
    const requested = String(body?.dimension || "").trim() as Dimension;
    const dimension = DIMENSIONS.includes(requested) && current?.[requested] === "UNVERIFIED"
      ? requested
      : DIMENSIONS.find(d => current?.[d] === "UNVERIFIED") || "demand";

    if (current?.[dimension] && current[dimension] !== "UNVERIFIED") {
      return NextResponse.json({ok:true,skipped:true,opportunityId,dimension,quality:current[dimension]});
    }

    const query = `Validate ${label(dimension)} for the business opportunity "${String(opportunity.name)}".
Current context: ${String(opportunity.why || "")}
Proposed next validation: ${String(opportunity.next_action || "")}

This is read-only business validation. Find recent, concrete, independent public evidence that can verify or challenge this dimension. Prefer primary sources, reputable market reports, official statistics, pricing pages, platform data, or credible industry research. Do not invent interviews, customers, transactions, revenue, or willingness-to-pay. Clearly distinguish facts from inference and state uncertainty. Return a concise evidence summary and the strongest sources.`;

    const response = await fetch("https://api.exa.ai/search", {
      method:"POST",
      headers:{"x-api-key":exaKey,"Content-Type":"application/json"},
      body:JSON.stringify({query,type:"deep",numResults:6}),
      cache:"no-store"
    });
    const raw = await response.text();
    let data:any = {};
    try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { data = {raw}; }
    if (!response.ok) return NextResponse.json({ok:false,error:readableError(data?.error || data?.message || data?.raw,`Validation research failed: ${response.status}`)},{status:502});

    const results = Array.isArray(data?.results) ? data.results : [];
    const sources = results.map((r:any)=>({title:String(r?.title||"Source"),url:String(r?.url||"").trim(),text:String(r?.text||r?.highlight||r?.summary||"").trim()})).filter((s:any)=>/^https?:\/\//.test(s.url));
    const answer = String(data?.answer || data?.output?.content || sources.map((s:any)=>`${s.title}: ${s.text}`).join(" ")).trim();
    if (!answer && sources.length === 0) return NextResponse.json({ok:false,error:"Validation research returned no usable evidence."},{status:502});

    const evidenceQuality = quality(sources.length,answer);
    const checkedOn = new Date().toISOString().slice(0,10);
    await supabaseRequest("evidence",{
      method:"POST",
      body:JSON.stringify({
        opportunity_id:opportunityId,type:"VALIDATION",
        claim:`${opportunity.name}: ${label(dimension)} validation`,
        source:sources[0]?.url || `Exa validation for ${opportunity.name}`,
        checked_on:checkedOn,quality:evidenceQuality,
        notes:`${answer.slice(0,4000)}${sources.length ? `\\n\\nSources reviewed: ${sources.map((s:any)=>s.url).join(", ")}` : ""}`
      }),
      headers:{"Prefer":"return=minimal"}
    });

    const nextVerification = {...current,opportunity_id:opportunityId,[dimension]:evidenceQuality};
    await supabaseRequest("opportunity_verification",{
      method:"POST",body:JSON.stringify(nextVerification),
      headers:{"Prefer":"resolution=merge-duplicates,return=representation"}
    });

    const remaining = DIMENSIONS.find(d => d !== dimension && (current?.[d] || "UNVERIFIED") === "UNVERIFIED");
    const nextAction = remaining
      ? `Verify ${remaining}`
      : "Review verification evidence and decide whether the opportunity deserves owner approval.";

    await supabaseRequest(`opportunities?id=eq.${encodeURIComponent(opportunityId)}`,{
      method:"PATCH",
      body:JSON.stringify({next_action:nextAction,status:remaining ? "CANDIDATE" : "VALIDATED"}),
      headers:{"Prefer":"return=minimal"}
    });

    let taskId = String(body?.taskId || "").trim();
    if (!taskId) {
      const readyTasks = await supabaseRequest(`tasks?opportunity_id=eq.${encodeURIComponent(opportunityId)}&status=eq.READY&order=created_at.asc&limit=1`);
      taskId = String(readyTasks?.[0]?.id || "");
    }
    if (taskId) {
      await supabaseRequest(`tasks?id=eq.${encodeURIComponent(taskId)}`,{
        method:"PATCH",body:JSON.stringify({status:"COMPLETE"}),headers:{"Prefer":"return=minimal"}
      });
    }

    if (remaining) {
      await supabaseRequest("tasks",{
        method:"POST",
        body:JSON.stringify({
          id:`${opportunityId}-verify-${remaining}`,
          title:`Validate ${label(remaining)}: ${opportunity.name}`,
          status:"READY",opportunity_id:opportunityId
        }),
        headers:{"Prefer":"return=minimal"}
      }).catch(()=>{});
    }

    return NextResponse.json({
      ok:true,opportunityId,dimension,quality:evidenceQuality,
      evidenceRecorded:true,taskCompleted:Boolean(taskId),nextAction,
      sources:sources.map((s:any)=>({title:s.title,url:s.url}))
    });
  } catch (error) {
    return NextResponse.json({ok:false,error:readableError(error,"Validation execution failed")},{status:500});
  }
}
