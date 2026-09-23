const opportunities=[
 {name:"AI-assisted local business lead research",model:"Service",capital:"R0 to start",status:"Research",why:"Find public business prospects, identify obvious gaps, prepare personalized outreach drafts, and let the owner approve/send them."},
 {name:"Micro-service delivery",model:"Service",capital:"R0 to start",status:"Candidate",why:"Package repeatable work such as research, data cleanup, listing optimization or simple content preparation; payment follows delivery."},
 {name:"Legitimate online task opportunities",model:"Tasks",capital:"R0 to start",status:"Phase 1",why:"Use the Future Plan's verification, scoring, payout and net-earnings ledger before spending time on a task."}
];

export default function Home(){
 return <main className="shell">
  <header className="top"><div className="brand">Autonomous Business Agent</div><span className="badge">LIVE BUILD • CONTROLLED</span></header>
  <section className="hero">
   <h1>Goal → Plan → Execute → Verify → Learn</h1>
   <p>This is a separate project from Earning Manager. It is being built as a working agent system, not a dashboard simulation. The first version focuses on zero-capital, service-based opportunities and measurable execution while keeping account-level and financial actions under owner approval.</p>
   <div className="notice"><strong>Safety boundary:</strong> no fake accounts, fake engagement, CAPTCHA bypass, hidden spending, wallet changes, or claims of revenue that has not actually been recorded.</div>
  </section>
  <section className="grid">
   <div className="card"><div className="muted">Actual revenue</div><div className="metric">R0.00</div><div className="muted">No revenue claimed until verified.</div></div>
   <div className="card"><div className="muted">Active opportunities</div><div className="metric">{opportunities.length}</div><div className="muted">Candidates awaiting verification.</div></div>
   <div className="card"><div className="muted">Capital required</div><div className="metric">R0</div><div className="muted">Initial business experiments.</div></div>
  </section>
  <section className="section card">
   <h2>Current opportunity board</h2>
   {opportunities.map((o)=><div className="opportunity" key={o.name}><div><strong>{o.name}</strong><div className="muted">{o.why}</div><span className="pill">{o.model} · {o.capital}</span></div><span className="muted">{o.status}</span></div>)}
  </section>
  <section className="section grid">
   <div className="card"><h3>Agent loop</h3><p className="muted">Discover → verify → score → save → approve → execute → record → reconcile → audit → improve.</p></div>
   <div className="card"><h3>Owner control</h3><p className="muted">Account creation, KYC, payments, wallets, terms and irreversible actions remain human-controlled.</p></div>
   <div className="card"><h3>Next layer</h3><p className="muted">Persistent tasks, evidence, approvals, earnings, audit events and real integrations will replace this initial static board.</p></div>
  </section>
 </main>
}