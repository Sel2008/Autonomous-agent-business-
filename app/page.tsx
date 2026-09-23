"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  id: string;
  name: string;
  model: string;
  capital: string;
  status: string;
  why: string;
  next: string;
};

type Task = {
  id: string;
  title: string;
  status: "READY" | "IN PROGRESS" | "BLOCKED" | "COMPLETE";
  opportunityId: string;
};

type Approval = {
  id: string;
  title: string;
  tier: "T1" | "T2" | "T3";
  status: "PENDING" | "APPROVED" | "REJECTED";
};

const opportunities: Opportunity[] = [
  { id:"lead-research", name:"AI-assisted local-business lead research", model:"Service", capital:"R0 to start", status:"RESEARCH", why:"Find public business prospects, identify obvious gaps, prepare personalized outreach drafts, and let the owner approve/send them.", next:"Define a repeatable lead-research checklist and evidence record." },
  { id:"micro-service", name:"Repeatable micro-service delivery", model:"Service", capital:"R0 to start", status:"CANDIDATE", why:"Package research, data cleanup, listing optimization or simple content preparation into a deliverable that can be sold after validation.", next:"Choose one narrowly defined deliverable and create a sample workflow." },
  { id:"online-tasks", name:"Legitimate online task opportunities", model:"Tasks", capital:"R0 to start", status:"PHASE 1", why:"Use verification, scoring, payout and net-earnings tracking before spending meaningful time on any task.", next:"Verify current opportunities before execution; no unverified earnings are counted." },
  { id:"pod-store", name:"Store / POD module", model:"Product", capital:"Later", status:"ROADMAP", why:"The original Store/POD plan remains intact and can be activated when research, economics and owner approval justify it.", next:"Keep as a separate business module; do not publish or spend without approval." }
];

const initialTasks: Task[] = [
  {id:"t1", title:"Verify the first zero-capital business workflow", status:"READY", opportunityId:"lead-research"},
  {id:"t2", title:"Define the evidence fields for opportunity verification", status:"READY", opportunityId:"lead-research"},
  {id:"t3", title:"Select the first micro-service to prototype", status:"READY", opportunityId:"micro-service"}
];

export default function Home() {
  const [tasks,setTasks]=useState<Task[]>(initialTasks);
  const [approvals,setApprovals]=useState<Approval[]>([]);
  const [selected,setSelected]=useState<Opportunity|null>(null);
  const [saved,setSaved]=useState(false);

  useEffect(()=>{
    try {
      const raw=localStorage.getItem("aba-mvp");
      if(raw){const s=JSON.parse(raw); if(Array.isArray(s.tasks)) setTasks(s.tasks); if(Array.isArray(s.approvals)) setApprovals(s.approvals);}
    } catch {}
  },[]);

  useEffect(()=>{
    try { localStorage.setItem("aba-mvp",JSON.stringify({tasks,approvals})); setSaved(true); const t=setTimeout(()=>setSaved(false),1200); return ()=>clearTimeout(t); } catch {}
  },[tasks,approvals]);

  const pending=approvals.filter(a=>a.status==="PENDING").length;
  const complete=tasks.filter(t=>t.status==="COMPLETE").length;
  const nextTask=useMemo(()=>tasks.find(t=>t.status!=="COMPLETE"),[tasks]);

  function advanceTask(id:string){
    setTasks(current=>current.map(t=>t.id===id ? {...t,status:t.status==="READY"?"IN PROGRESS":t.status==="IN PROGRESS"?"COMPLETE":t.status} : t));
  }
  function requestApproval(){
    const id=String(Date.now());
    setApprovals(a=>[...a,{id,title:"Owner approval: proceed with the first verified business experiment",tier:"T2",status:"PENDING"}]);
  }
  function decideApproval(id:string,status:"APPROVED"|"REJECTED"){
    setApprovals(a=>a.map(x=>x.id===id?{...x,status}:x));
  }

  return <main className="shell">
    <header className="top"><div><div className="brand">Autonomous Business Agent</div><div className="subbrand">Controlled business experimentation layer</div></div><span className="badge">MVP • {saved?"SAVED":"READY"}</span></header>

    <section className="hero">
      <div>
        <div className="eyebrow">OWNER-CONTROLLED AGENT LOOP</div>
        <h1>Goal → Plan → Execute → Verify → Learn</h1>
        <p>This separate project is now moving from a static dashboard toward an operational MVP. It records tasks and approvals locally, keeps actual revenue at zero until verified, and treats the Store/POD route as one module inside a wider business system.</p>
      </div>
      <div className="notice"><strong>Control boundary:</strong> account creation, KYC, payments, wallets, accepting terms and irreversible actions remain owner-controlled. No fabricated earnings or bypasses.</div>
    </section>

    <section className="grid metrics">
      <div className="card"><div className="muted">Actual revenue</div><div className="metric">R0.00</div><div className="muted">Verified revenue only.</div></div>
      <div className="card"><div className="muted">Tasks complete</div><div className="metric">{complete}/{tasks.length}</div><div className="muted">MVP execution ledger.</div></div>
      <div className="card"><div className="muted">Pending approvals</div><div className="metric">{pending}</div><div className="muted">Owner decisions required.</div></div>
    </section>

    <section className="section">
      <div className="section-head"><div><div className="eyebrow">01 · OPPORTUNITY ENGINE</div><h2>Business opportunity board</h2></div><button className="button" onClick={requestApproval}>Request approval</button></div>
      <div className="cards">
        {opportunities.map(o=><button className="opportunity card" key={o.id} onClick={()=>setSelected(o)}>
          <div className="op-top"><span className="pill">{o.status}</span><span className="muted">{o.capital}</span></div>
          <h3>{o.name}</h3><p className="muted">{o.why}</p><div className="next">Next: {o.next}</div>
        </button>)}
      </div>
    </section>

    <section className="section grid two">
      <div className="card">
        <div className="eyebrow">02 · TASK MANAGER</div><h2>Execution queue</h2>
        {tasks.map(t=><div className="row" key={t.id}><div><strong>{t.title}</strong><div className="muted">{t.status}</div></div><button className="small-button" disabled={t.status==="COMPLETE"} onClick={()=>advanceTask(t.id)}>{t.status==="READY"?"Start":t.status==="IN PROGRESS"?"Complete":"Done"}</button></div>)}
      </div>
      <div className="card">
        <div className="eyebrow">03 · APPROVAL CENTER</div><h2>Owner decisions</h2>
        {approvals.length===0 && <p className="muted">No approval requests yet. Use “Request approval” when a real account-level or material action is ready.</p>}
        {approvals.map(a=><div className="row" key={a.id}><div><strong>{a.title}</strong><div className="muted">{a.tier} · {a.status}</div></div>{a.status==="PENDING" && <div className="actions"><button className="small-button" onClick={()=>decideApproval(a.id,"APPROVED")}>Approve</button><button className="small-button" onClick={()=>decideApproval(a.id,"REJECTED")}>Reject</button></div>}</div>)}
      </div>
    </section>

    <section className="section card architecture">
      <div><div className="eyebrow">04 · SYSTEM PATH</div><h2>What we are building</h2></div>
      <div className="flow"><span>Discover</span><b>→</b><span>Verify</span><b>→</b><span>Score</span><b>→</b><span>Approve</span><b>→</b><span>Execute</span><b>→</b><span>Record</span><b>→</b><span>Audit</span><b>→</b><span>Improve</span></div>
      <p className="muted">The next engineering step is a real persistent evidence/task ledger and then controlled integrations. We will add external tools only when a capability gap actually appears.</p>
    </section>

    {selected && <div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="modal card" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelected(null)}>×</button><div className="eyebrow">OPPORTUNITY DETAIL</div><h2>{selected.name}</h2><p className="muted">{selected.why}</p><div className="detail"><span>Model</span><strong>{selected.model}</strong><span>Starting capital</span><strong>{selected.capital}</strong><span>Status</span><strong>{selected.status}</strong></div><div className="next">Next action: {selected.next}</div></div></div>}
  </main>
}
