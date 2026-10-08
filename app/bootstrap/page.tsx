"use client";

import { useEffect, useState } from "react";

type BootstrapData={
  configured:boolean; schemaReady:boolean;
  balances:{available:number;pending:number;withdrawable:number;totalEarned:number;today:number;week:number};
  activeTasks:any[]; opportunities:any[]; fundingRequests:any[]; accounts:any[]; safety:string[]; error?:string;
};
const empty:BootstrapData={configured:true,schemaReady:false,balances:{available:0,pending:0,withdrawable:0,totalEarned:0,today:0,week:0},activeTasks:[],opportunities:[],fundingRequests:[],accounts:[],safety:[]};

export default function BootstrapPage(){
 const [data,setData]=useState<BootstrapData>(empty);
 const [loading,setLoading]=useState(true);
 async function load(){
  try{const r=await fetch("/api/bootstrap",{cache:"no-store"});setData({...empty,...await r.json()});}
  catch{setData({...empty,error:"Bootstrap engine could not be reached."})}
  finally{setLoading(false)}
 }
 useEffect(()=>{load();const t=window.setInterval(load,3000);return()=>window.clearInterval(t)},[]);

 return <main className="shell">
  <header className="top">
   <div><div className="brand">Bootstrap Earnings</div><div className="subbrand">Funding Engine · Earnings · Capital Queue</div></div>
   <div className="actions"><a href="/" className="pill" style={{textDecoration:"none"}}>← Dashboard</a></div>
  </header>
  <section className="hero">
   <div className="eyebrow">BOOTSTRAP FUNDING ENGINE</div><h1>Earn first. Spend later.</h1>
   <p>The agent can pursue legitimate zero-upfront work, record real payouts, accumulate capital, and later propose funding for a queued business. It never treats projected earnings as cash.</p>
   <div className="notice"><strong>Capital rule:</strong> available capital starts at R0.00. No money is spent to unlock work, and no earned funds are moved or spent without the required owner approval.</div>
  </section>
  {!data.schemaReady&&<section className="section card"><div className="eyebrow">SETUP REQUIRED</div><h2>The earnings ledger is ready in code, but its persistent tables are not installed yet.</h2><p className="muted">Apply <code>supabase/capital_schema.sql</code> to the Supabase project, then this page becomes the live earnings ledger.</p></section>}
  <section className="grid metrics">
   <div className="card"><div className="muted">Available capital</div><div className="metric">R{data.balances.available.toFixed(2)}</div><div className="muted">Recorded capital, not permission to spend.</div></div>
   <div className="card"><div className="muted">Earned today</div><div className="metric">R{data.balances.today.toFixed(2)}</div></div>
   <div className="card"><div className="muted">Earned this week</div><div className="metric">R{data.balances.week.toFixed(2)}</div></div>
   <div className="card"><div className="muted">Total earned</div><div className="metric">R{data.balances.totalEarned.toFixed(2)}</div></div>
  </section>
  <section className="section grid two">
   <div className="card"><div className="eyebrow">AGENT EARNING LOOP</div><h2>Find → Verify → Work → Earn → Record → Repeat</h2>
    <div className="row"><strong>Active tasks</strong><span className="pill">{data.activeTasks.length}</span></div>
    {data.activeTasks.length===0?<p className="muted">No verified earning task is currently active.</p>:data.activeTasks.map((t:any)=><div className="row" key={t.id}><div><strong>{t.title}</strong><div className="muted">{t.status} · Net R{Number(t.net_amount||0).toFixed(2)}</div></div></div>)}
   </div>
   <div className="card"><div className="eyebrow">ACCOUNT RAILS</div><h2>Receiving & spending accounts</h2>
    {data.accounts.length===0?<p className="muted">No payment account is connected yet. Account connection remains an owner-controlled action.</p>:data.accounts.map((a:any)=><div className="row" key={a.id}><div><strong>{a.name}</strong><div className="muted">{a.provider} · {a.account_role} · {a.connected?"Connected":"Not connected"}</div></div><span className="pill">{a.owner_approved?"Owner approved":"Owner approval required"}</span></div>)}
   </div>
  </section>
  <section className="section card"><div className="eyebrow">CAPITAL QUEUE</div><h2>Businesses waiting for earned funds</h2><p className="muted">A business that cannot start at R0 is not discarded. It is queued while the earning engine looks for legitimate zero-cost work.</p>
   {data.fundingRequests.length===0?<div className="notice">No funding request is currently queued.</div>:data.fundingRequests.map((f:any)=><div className="row" key={f.id}><div><strong>{f.opportunity_name||f.opportunity_id}</strong><div className="muted">Needs R{Number(f.requested_amount||0).toFixed(2)} · {f.status}</div><div className="muted">{f.reason}</div></div><span className="pill">{f.status}</span></div>)}
  </section>
  <section className="section card"><div className="eyebrow">VERIFIED EARNING OPPORTUNITIES</div><h2>Safe work candidates</h2>
   {data.opportunities.length===0?<p className="muted">No earning opportunity has passed the bootstrap safety gates yet.</p>:data.opportunities.map((o:any)=><div className="row" key={o.id}><div><strong>{o.title}</strong><div className="muted">{o.provider} · {o.status} · Upfront R{Number(o.upfront_cost||0).toFixed(2)}</div><div className="muted">{o.notes}</div></div><span className="pill">{o.risk_status}</span></div>)}
  </section>
  <section className="section card"><div className="eyebrow">NON-NEGOTIABLE SAFETY RULES</div>{data.safety.map((s,i)=><div className="row" key={i}><span>✓</span><div>{s}</div></div>)}</section>
  {data.error&&<div className="notice">{data.error}</div>}{loading&&<p className="muted">Loading live capital ledger…</p>}
 </main>
}
