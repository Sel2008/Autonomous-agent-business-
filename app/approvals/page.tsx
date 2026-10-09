"use client";

import { useEffect, useState } from "react";

type Approval={id:string;title:string;tier:"T1"|"T2"|"T3";status:"PENDING"|"APPROVED"|"REJECTED";reason?:string};
type Opportunity={id:string;name:string;status:string};

function parsePlanNotes(notes:string){
 const plan:Record<string,string>={};
 String(notes||"").split("\n").forEach(line=>{
  const i=line.indexOf(": ");
  if(i>0) plan[line.slice(0,i).trim()]=line.slice(i+2).trim();
 });
 return plan;
}

const fields=[
 ["offer","Offer"],["idealCustomer","Ideal customer"],["problemSolved","Problem solved"],
 ["deliverable","Deliverable"],["pricing","Pricing test"],["acquisition","Customer acquisition"],
 ["firstPaidTest","First paid test"],["expectedCosts","Expected cash cost"],
 ["risks","Risks"],["successMetric","Success metric"]
];

export default function ApprovalsPage(){
 const [approval,setApproval]=useState<Approval|null>(null);
 const [opportunity,setOpportunity]=useState<Opportunity|null>(null);
 const [plan,setPlan]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const isFundingResume=String(approval?.title||"").startsWith("Approve funded opportunity resumption:");

 async function load(){
  setLoading(true);
  try{
   const r=await fetch("/api/ledger",{cache:"no-store"});
   const ledger=await r.json();
   const pending=(Array.isArray(ledger.approvals)?ledger.approvals:[]).find((a:any)=>a.status==="PENDING"&&!String(a.title||"").startsWith("Bootstrap permission review:"))||null;
   setApproval(pending);
   const opps=Array.isArray(ledger.opportunities)?ledger.opportunities:[];
   const winner=opps.find((o:any)=>String(o.status||"").toUpperCase()==="SELECTED")||null;
   setOpportunity(winner);
   const ev=Array.isArray(ledger.evidence)?ledger.evidence:[];
   const planEvidence=winner?ev.find((e:any)=>String(e.opportunity_id||"")===String(winner.id)&&e.type==="MONETIZATION_PLAN"):null;
   setPlan(planEvidence?parsePlanNotes(planEvidence.notes):{});
  }catch{setMessage("Could not load the current approval. Please refresh.");}
  finally{setLoading(false)}
 }

 useEffect(()=>{load()},[]);

 async function decide(status:"APPROVED"|"REJECTED"){
  if(!approval)return;
  setBusy(true); setMessage("");
  try{
   const r=await fetch("/api/ledger",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approval-decide",payload:{id:approval.id,status,...(isFundingResume?{}:{opportunityId:opportunity?.id})}})});
   const result=await r.json().catch(()=>({}));
   if(!r.ok||result.ok===false) throw new Error(result.error||"Approval decision failed");
   setApproval({...approval,status});
   setMessage(isFundingResume?(status==="APPROVED"?"Resumption approved. The next worker heartbeat will re-check funding, verification, and whether another opportunity is selected.":"Resumption rejected. The funded opportunity will remain queued."):(status==="APPROVED"?"Approved. The agent may continue to the next stage.":"Rejected. The agent will remain stopped on this test."));
  }catch(e){setMessage(e instanceof Error?e.message:"Approval decision failed.");}
  finally{setBusy(false)}
 }

 return <main className="shell">
  <header className="top">
   <div><div className="brand">Autonomous Business Agent</div><div className="subbrand">Owner Approval · Review & Decision</div></div>
   <div className="actions"><a href="/" className="pill" style={{textDecoration:"none"}}>← Dashboard</a></div>
  </header>

  <section className="hero">
   <div className="eyebrow">OWNER APPROVAL</div>
   <h1>Review before the agent continues</h1>
   <p>This page is the owner decision gate. The agent has already completed the safe preparation. Nothing consequential should happen until you explicitly approve it.</p>
  </section>

  {loading?<section className="section card"><p className="muted">Loading current approval…</p></section>:
   !approval?<section className="section card"><div className="eyebrow">NO PENDING APPROVAL</div><h2>The agent is not waiting for an owner decision.</h2><p className="muted">Return to the dashboard to see the current agent state.</p><a href="/" className="button" style={{display:"inline-block",textDecoration:"none",marginTop:12}}>Back to dashboard</a></section>:
   <section className="section card" style={{border:"1px solid rgba(130,210,255,.45)"}}>
    <div className="eyebrow">DECISION REQUIRED</div>
    <h2>{approval.title}</h2>
    <div className="muted">{approval.tier} · {approval.status}</div>
    <div className="notice" style={{marginTop:16}}><strong>Owner boundary:</strong> {isFundingResume?"This approval only allows the Business Brain to resume non-sending planning/preparation for an opportunity whose required ZAR capital has been internally reserved. It does not authorize a purchase, transfer, spending, or outreach sending.":"Approving this allows the agent to move beyond the current approval gate. Review the plan below before deciding."}</div>

    {!isFundingResume&&opportunity&&<div className="card" style={{marginTop:20}}>
     <div className="eyebrow">MONETIZATION PLAN</div>
     <h3 style={{margin:"8px 0 18px"}}>{opportunity.name}</h3>
     <div className="grid two">
      {fields.map(([key,label])=><div key={key} style={{padding:"10px 0"}}><div className="muted">{label}</div><div>{plan[key]||"Not specified in the current plan."}</div></div>)}
     </div>
    </div>}

    {message&&<div className="notice" style={{marginTop:16}}>{message}</div>}

    {approval.status==="PENDING"&&<div className="actions" style={{marginTop:20}}>
     <button className="button" disabled={busy} onClick={()=>decide("APPROVED")}>{busy?"Saving…":"Approve & let agent continue"}</button>
     <button className="small-button" disabled={busy} onClick={()=>decide("REJECTED")}>Reject / stop this test</button>
    </div>}
    <p className="muted" style={{marginTop:14}}>{isFundingResume?"The worker still checks the funding reservation and all five verification dimensions. Outreach sending and any actual spending remain separate guarded actions.":"You are approving the next consequential step, not manually performing the agent's research or preparation."}</p>
   </section>
  }
 </main>
}
