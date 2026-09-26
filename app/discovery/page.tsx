"use client";

import { useState } from "react";

type Candidate = {
  name:string; opportunityType:string; market:string; rationale:string;
  pursuitPriority:number; confidence:number;
  demandEvidence:string; accessEvidence:string; economicsEvidence:string;
  repeatabilityEvidence:string; riskEvidence:string; risks:string[];
  nextValidation:string; sourceUrls:string[];
};

export default function DiscoveryPage(){
  const [goal,setGoal]=useState("Find viable zero-capital business or service opportunities that have enough public evidence to justify further validation.");
  const [marketScope,setMarketScope]=useState("Global");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [summary,setSummary]=useState("");
  const [candidates,setCandidates]=useState<Candidate[]>([]);

  async function run(){
    setLoading(true); setError(""); setCandidates([]); setSummary("");
    try{
      const r=await fetch("/api/discovery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal,marketScope})});
      const data=await r.json();
      if(!r.ok || !data.ok) throw new Error(data.error||"Discovery failed");
      setSummary(data.summary||"Research completed.");
      setCandidates(data.candidates||[]);
    }catch(e){setError(e instanceof Error?e.message:"Discovery failed")}
    finally{setLoading(false)}
  }

  return <main className="shell">
    <header className="top">
      <div><div className="brand">Autonomous Business Agent</div><div className="subbrand">Discovery + Evidence Research Test</div></div>
      <span className="badge">RESEARCH ONLY • NO EXECUTION</span>
    </header>

    <section className="hero">
      <div className="eyebrow">01 · DISCOVERY TEST</div>
      <h1>Find opportunities, then investigate them.</h1>
      <p>The agent does not treat your initial idea as proof. It searches public sources, compares evidence across demand, access, economics, repeatability and risk, then produces a transparent pursuit-priority assessment.</p>
      <div className="notice"><strong>Execution is OFF.</strong> This test may research and recommend a next validation step, but it will not contact businesses, create accounts, spend money, accept terms or take irreversible actions.</div>
    </section>

    <section className="section card">
      <div className="eyebrow">02 · MISSION INPUT</div>
      <h2>What should the agent research?</h2>
      <label className="muted">Goal</label>
      <textarea value={goal} onChange={e=>setGoal(e.target.value)} style={{width:"100%",minHeight:110,marginTop:8,padding:12,borderRadius:10,border:"1px solid #334155",background:"#08111f",color:"#eef2ff"}} />
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
        <div><label className="muted">Market scope</label><select value={marketScope} onChange={e=>setMarketScope(e.target.value)} style={{width:"100%",marginTop:8,padding:11,borderRadius:10,border:"1px solid #334155",background:"#08111f",color:"#eef2ff"}}><option>Global</option><option>South Africa</option><option>United States</option><option>United Kingdom</option><option>Australia</option><option>Canada</option><option>Specific country or city</option></select></div>
        <div><label className="muted">Action mode</label><div className="next" style={{marginTop:8}}>RESEARCH ONLY<br/><span className="muted">Owner approval required before execution is ever enabled.</span></div></div>
      </div>
      <button className="button" style={{marginTop:16}} onClick={run} disabled={loading}>{loading?"Researching…":"Start discovery + research"}</button>
      {error&&<div className="notice" style={{marginTop:14}}><strong>Research not started:</strong> {error}</div>}
    </section>

    {summary&&<section className="section card"><div className="eyebrow">03 · RESEARCH SYNTHESIS</div><h2>What the agent found</h2><p className="muted">{summary}</p></section>}

    {candidates.length>0&&<section className="section">
      <div className="eyebrow">04 · EVIDENCE-BACKED PRIORITIZATION</div>
      <h2>Candidates worth the next validation step</h2>
      <p className="muted">“Pursuit priority” is a research-based prioritization aid, not a guarantee of success. Weak or conflicting evidence lowers confidence.</p>
      <div className="cards">
      {candidates.map((c,i)=><article className="card" key={c.name+i}>
        <div className="op-top"><span className="pill">Priority {Math.round(c.pursuitPriority)}/100</span><span className="muted">Confidence {Math.round(c.confidence)}%</span></div>
        <h3>{c.name}</h3><div className="muted">{c.opportunityType} · {c.market}</div>
        <p>{c.rationale}</p>
        <div className="next"><strong>Demand:</strong> {c.demandEvidence}</div>
        <div className="next"><strong>Access:</strong> {c.accessEvidence}</div>
        <div className="next"><strong>Economics:</strong> {c.economicsEvidence}</div>
        <div className="next"><strong>Repeatability:</strong> {c.repeatabilityEvidence}</div>
        <div className="next"><strong>Risk:</strong> {c.riskEvidence}</div>
        {c.risks?.length>0&&<div className="notice"><strong>Risks:</strong> {c.risks.join(" • ")}</div>}
        <div className="next"><strong>Next validation:</strong> {c.nextValidation}</div>
        <div style={{marginTop:12}}><strong>Sources</strong>{c.sourceUrls?.map((u,j)=><div key={j} className="source">{u}</div>)}</div>
      </article>)}
      </div>
    </section>}
  </main>
}
