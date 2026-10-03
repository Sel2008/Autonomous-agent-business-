"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity={id:string;name:string;model:string;capital:string;status:string;why:string;next:string};
type Task={id:string;title:string;status:"READY"|"IN PROGRESS"|"BLOCKED"|"COMPLETE";opportunityId:string};
type Approval={id:string;title:string;tier:"T1"|"T2"|"T3";status:"PENDING"|"APPROVED"|"REJECTED"};
type Evidence={id:string;opportunityId:string;type:string;claim:string;source:string;checked:string;quality:"UNVERIFIED"|"CHECKED"|"STRONG";notes:string};
type Verification={demand:"UNVERIFIED"|"CHECKED"|"STRONG";access:"UNVERIFIED"|"CHECKED"|"STRONG";margin:"UNVERIFIED"|"CHECKED"|"STRONG";repeatability:"UNVERIFIED"|"CHECKED"|"STRONG";risk:"UNVERIFIED"|"CHECKED"|"STRONG"};

const BOOTSTRAP_OPPORTUNITIES=new Set(["lead-research","micro-service","online-tasks","pod-store"]);
const BOOTSTRAP_TASKS=new Set(["t1","t2","t3"]);
const BOOTSTRAP_EVIDENCE=new Set(["e1"]);

function levelValue(v:Verification[keyof Verification]){return v==="STRONG"||v==="CHECKED"?1:0}
function verificationPercent(v:Verification){const keys:(keyof Verification)[]=["demand","access","margin","repeatability","risk"];return Math.round(keys.reduce((n,k)=>n+levelValue(v[k]),0)/keys.length*100)}

export default function Home(){
 const [mission,setMission]=useState("Find and validate a zero-capital business opportunity that can realistically generate revenue.");
 const [opportunities,setOpportunities]=useState<Opportunity[]>([]);
 const [tasks,setTasks]=useState<Task[]>([]);
 const [approvals,setApprovals]=useState<Approval[]>([]);
 const [evidence,setEvidence]=useState<Evidence[]>([]);
 const [verification,setVerification]=useState<Record<string,Verification>>({});
 const [agentAction,setAgentAction]=useState<any>(null);
 const [dbStatus,setDbStatus]=useState<"checking"|"connected"|"local">("checking");
 const [tab,setTab]=useState<"overview"|"evidence"|"scoring">("overview");
 const [selected,setSelected]=useState<string|null>(null);
 const [missionSaved,setMissionSaved]=useState(false);
 const [agentRun,setAgentRun]=useState<any>(null);

 const load=async()=>{
  try{
   const [ledgerResponse,actionResponse,runResponse]=await Promise.all([
    fetch("/api/ledger",{cache:"no-store"}),
    fetch("/api/agent/next-action",{cache:"no-store"}),
    fetch("/api/discovery",{cache:"no-store"})
   ]);
   const ledger=await ledgerResponse.json();
   const action=await actionResponse.json().catch(()=>({}));
   const history=await runResponse.json().catch(()=>({}));
   setAgentAction(action.action||null);
   const latest=Array.isArray(history.runs)
     ? history.runs.find((x:any)=>x?.mode==="AGENT_RUN" || x?.mode==="OWNER_APPROVAL_EXECUTION") || history.runs[0]
     : null;
   if(latest) setAgentRun(latest);
   if(!ledger.configured){setDbStatus("local");return}
   const liveOpps=Array.isArray(ledger.opportunities)?ledger.opportunities.filter((x:any)=>!BOOTSTRAP_OPPORTUNITIES.has(x.id)):[];
   const liveTasks=Array.isArray(ledger.tasks)?ledger.tasks.filter((x:any)=>!BOOTSTRAP_TASKS.has(x.id)&&!BOOTSTRAP_OPPORTUNITIES.has(x.opportunity_id)):[];
   const liveEvidence=Array.isArray(ledger.evidence)?ledger.evidence.filter((x:any)=>!BOOTSTRAP_EVIDENCE.has(x.id)&&!BOOTSTRAP_OPPORTUNITIES.has(x.opportunity_id)):[];
   setOpportunities(liveOpps.map((x:any)=>({id:x.id,name:x.name,model:x.model,capital:x.capital,status:x.status,why:x.why,next:x.next_action||x.next||"Continue validation."})));
   setTasks(liveTasks.map((x:any)=>({id:x.id,title:x.title,status:x.status,opportunityId:x.opportunity_id})));
   setApprovals(Array.isArray(ledger.approvals)?ledger.approvals:[]);
   setEvidence(liveEvidence.map((x:any)=>({id:x.id,opportunityId:x.opportunity_id,type:x.type,claim:x.claim,source:x.source,checked:x.checked_on,quality:x.quality,notes:x.notes||""})));
   if(Array.isArray(ledger.verification)){const m:Record<string,Verification>={};ledger.verification.forEach((x:any)=>{if(!BOOTSTRAP_OPPORTUNITIES.has(x.opportunity_id))m[x.opportunity_id]={demand:x.demand,access:x.access,margin:x.margin,repeatability:x.repeatability,risk:x.risk}});setVerification(m)}
   setDbStatus("connected");
  }catch{setDbStatus("local")}
 };
 useEffect(()=>{
  load();
  const timer=window.setInterval(load,2000);
  return()=>window.clearInterval(timer);
 },[]);

 const complete=tasks.filter(t=>t.status==="COMPLETE").length;
 const checked=evidence.filter(e=>e.quality!=="UNVERIFIED").length;
 const businessResults=evidence.filter(e=>e.type==="BUSINESS_RESULT");
 const verifiedRevenue=businessResults.reduce((sum,e)=>{try{const x=JSON.parse(e.notes||"{}");return sum+(Number(x.amount)||0)}catch{return sum}},0);
 const pendingApprovals=approvals.filter(a=>a.status==="PENDING").length;
 const nextTask=useMemo(()=>tasks.find(t=>t.status!=="COMPLETE"),[tasks]);
 const selectedOpportunity=opportunities.find(o=>o.id===selected);

 async function decideApproval(id:string,status:"APPROVED"|"REJECTED"){
  setApprovals(x=>x.map(a=>a.id===id?{...a,status}:a));
  await fetch("/api/ledger",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approval-decide",payload:{id,status}})}).catch(()=>{});
  load();
 }
 function saveMission(){
  localStorage.setItem("aba-owner-mission",mission);
  setMissionSaved(true);setTimeout(()=>setMissionSaved(false),1200);
 }
 return <main className="shell">
  <header className="top">
   <div><div className="brand">Autonomous Business Agent</div><div className="subbrand">Owner Console · Agent Activity · Business Results</div></div>
   <div className="actions"><span className="badge">{dbStatus==="connected"?"DB CONNECTED":dbStatus==="checking"?"DB CHECKING":"LOCAL FALLBACK"}</span><span className="pill">{agentAction?.brain||"DETERMINISTIC"} BRAIN</span><a href="/discovery" className="pill" style={{textDecoration:"none"}}>Research & Discovery</a></div>
  </header>

  <section className="hero">
   <div className="eyebrow">OWNER CONSOLE</div>
   <h1>You set the mission. The agent works the mission.</h1>
   <p>Use this page to define the business objective and make owner decisions. Research, evidence gathering, verification and task creation belong to the agent workflow.</p>
   <div className="card" style={{marginTop:20}}>
    <div className="eyebrow">YOUR MISSION</div>
    <textarea value={mission} onChange={e=>setMission(e.target.value)} style={{width:"100%",minHeight:90,marginTop:10,padding:14,borderRadius:12,border:"1px solid rgba(255,255,255,.12)",background:"rgba(0,0,0,.15)",color:"inherit",font: "inherit"}} />
    <div className="actions" style={{marginTop:12}}><button className="button" onClick={saveMission}>Save mission</button>{missionSaved&&<span className="pill">Saved</span>}</div>
   </div>
   <div className="notice"><strong>Owner boundary:</strong> you approve consequential actions such as spending, account creation, accepting terms, payments and other irreversible actions. You do not manually complete the agent's research or validation tasks.</div>
  </section>

  <section className="grid metrics">
   <div className="card"><div className="muted">Agent status</div><div className="metric" style={{fontSize:24}}>{agentRun?.status||"READY"}</div><div className="muted">{agentRun?.summary||"The agent is ready for a mission."}</div></div>
   <div className="card"><div className="muted">Live opportunities</div><div className="metric">{opportunities.length}</div><div className="muted">Research-generated records only.</div></div>
   <div className="card"><div className="muted">Pending approvals</div><div className="metric">{pendingApprovals}</div><div className="muted">Owner decisions required.</div></div>
  </section>

  <section className="section card">
   <div className="eyebrow">AGENT ACTIVITY</div><h2>What the agent is doing</h2>
   <div className="notice"><strong>Live agent status:</strong> {agentRun?.status||"READY"}<br/><strong>{agentRun?.summary||agentAction?.action||"Reading the live ledger…"}</strong><br/><span className="muted">{agentAction?.reason||"The Agent Core is checking the current state."} · Permission: {agentAction?.permission||"READ_ONLY"}</span></div>
   <div className="grid two" style={{marginTop:16}}>
    <div><div className="muted">Next validation task</div><strong>{nextTask?.title||"No live validation task currently queued."}</strong></div>
    <div><div className="muted">Task history</div><strong>{complete} completed · {tasks.length} live tasks</strong></div>
   </div>
  </section>

  <div className="tabs"><button className={tab==="overview"?"tab active":"tab"} onClick={()=>setTab("overview")}>Operations</button><button className={tab==="evidence"?"tab active":"tab"} onClick={()=>setTab("evidence")}>Evidence</button><button className={tab==="scoring"?"tab active":"tab"} onClick={()=>setTab("scoring")}>Scoring</button></div>

  {tab==="overview"&&<>
   <section className="section"><div className="section-head"><div><div className="eyebrow">LIVE BUSINESS STATE</div><h2>Opportunities researched by the agent</h2></div><a href="/discovery" className="button" style={{textDecoration:"none"}}>Open research workspace</a></div>
    {opportunities.length===0?<div className="card"><p className="muted">No live research-generated opportunities yet. Run a research mission, then return here. Bootstrap/demo records are intentionally hidden from this view.</p></div>:<div className="cards">{opportunities.map(o=><button className="opportunity card" key={o.id} onClick={()=>setSelected(o.id)}><div className="op-top"><span className="pill">{o.status}</span><span className="muted">{o.capital}</span></div><h3>{o.name}</h3><p className="muted">{o.why}</p><div className="next">Agent next: {o.next}</div></button>)}</div>}
   </section>
   <section className="section grid two">
    <div className="card"><div className="eyebrow">AGENT TASK QUEUE</div><h2>Validation work</h2>{tasks.length===0?<p className="muted">No live validation tasks yet.</p>:tasks.map(t=><div className="row" key={t.id}><div><strong>{t.title}</strong><div className="muted">{t.status}</div></div><span className="pill">Agent-managed</span></div>)}</div>
    <div className="card"><div className="eyebrow">OWNER DECISIONS</div><h2>Approval center</h2>{approvals.length===0?<p className="muted">No approval requests.</p>:approvals.map(a=><div className="row" key={a.id}><div><strong>{a.title}</strong><div className="muted">{a.tier} · {a.status}</div></div>{a.status==="PENDING"&&<div className="actions"><button className="small-button" onClick={()=>decideApproval(a.id,"APPROVED")}>Approve</button><button className="small-button" onClick={()=>decideApproval(a.id,"REJECTED")}>Reject</button></div>}</div>)}</div>
   </section>
  </>}

  {tab==="evidence"&&<section className="section card"><div className="eyebrow">AGENT EVIDENCE</div><h2>What the agent has found</h2><p className="muted">Research findings appear here as evidence. Unverified evidence is not treated as proof, revenue or a business result.</p>{evidence.length===0?<p className="muted">No live research evidence yet.</p>:evidence.map(e=><div className="evidence" key={e.id}><div><strong>{e.claim}</strong><div className="muted">{opportunities.find(o=>o.id===e.opportunityId)?.name||"Live research opportunity"} · {e.type}</div><div className="source">Source: {e.source}</div><div className="muted">Checked: {e.checked} · {e.notes}</div></div><span className={e.quality==="UNVERIFIED"?"pill warning":"pill"}>{e.quality}</span></div>)}</section>}

  {tab==="scoring"&&<section className="section card"><div className="eyebrow">AGENT ASSESSMENT</div><h2>Opportunity verification</h2><p className="muted">Scoring is an agent assessment of the live research set. It is not a guarantee of revenue.</p>{opportunities.length===0?<p className="muted">No live research opportunities to assess.</p>:opportunities.map(o=>{const v=verification[o.id]||{demand:"UNVERIFIED",access:"UNVERIFIED",margin:"UNVERIFIED",repeatability:"UNVERIFIED",risk:"UNVERIFIED"} as Verification;return <div className="evidence" key={o.id}><div><strong>{o.name}</strong><div className="muted">Verification progress: {verificationPercent(v)}%</div></div><span className="pill">{verificationPercent(v)}% verified</span></div>})}</section>}

  <section className="section card"><div className="eyebrow">BUSINESS RESULTS</div><h2>Revenue & outcomes</h2><div className="grid metrics"><div><div className="muted">Verified revenue</div><div className="metric">R{verifiedRevenue.toFixed(2)}</div></div><div><div className="muted">Costs recorded</div><div className="metric">R0.00</div></div><div><div className="muted">Completed jobs</div><div className="metric">{businessResults.length}</div></div></div><p className="muted">These are business outcomes, not task-completion counts. Revenue will be recorded separately when an actual paid outcome exists.</p></section>

  {selectedOpportunity&&<section className="section card"><div className="section-head"><div><div className="eyebrow">SELECTED OPPORTUNITY</div><h2>{selectedOpportunity.name}</h2></div><button className="small-button" onClick={()=>setSelected(null)}>Close</button></div><p className="muted">{selectedOpportunity.why}</p><div className="next">Agent next: {selectedOpportunity.next}</div></section>}

  <section className="section card architecture"><div className="eyebrow">OPERATING MODEL</div><h2>Owner → Mission → Agent → Approval → Execution → Results → Learning</h2><p className="muted">The interface now distinguishes owner decisions from agent work. Research and validation are not presented as manual checklist work for the owner.</p></section>
 </main>
}
