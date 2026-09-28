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
  const [sourceUrls,setSourceUrls]=useState<string[]>([]);
  const [runInfo,setRunInfo]=useState<{researchRunId:string|null;opportunitiesCreated:number}|null>(null);

  async function run(){
    setLoading(true); setError(""); setCandidates([]); setSummary(""); setSourceUrls([]); setRunInfo(null);
    try{
      // The owner supplies the mission. The agent decides that research is
      // the first internal step; the owner is not manually performing research.
      const r=await fetch("/api/agent/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal,marketScope})});
      const data=await r.json();
      if(!r.ok || !data.ok) throw new Error(data.error||"Agent run failed");
      setRunInfo(data.run||null);
      const researchRunId=data?.run?.researchRunId;
      // Read the completed run so this page displays the agent's actual work.
      if(researchRunId){
        const history=await fetch("/api/discovery",{cache:"no-store"});
        const historyData=await history.json();
        const runData=Array.isArray(historyData.runs)?historyData.runs.find((x:any)=>x.id===researchRunId):null;
        setSummary(runData?.summary||"Agent research completed.");
        setCandidates(Array.isArray(runData?.candidates)?runData.candidates:[]);
        const urls=(Array.isArray(runData?.candidates)?runData.candidates.flatMap((c:any)=>Array.isArray(c.source_urls)?c.source_urls:[]):[]);
        setSourceUrls(Array.from(new Set(urls)).filter((u):u is string=>typeof u==="string" && /^https?:\/\//i.test(u)));
      }
    }catch(e){setError(e instanceof Error?e.message:"Agent run failed")}
    finally{setLoading(false)}
  }

  return <main className="shell">
    <header className="top"><div><div className="brand">Autonomous Business Agent</div><div className="subbrand">Owner Mission → Agent Activity</div></div><div style={{display:"flex",alignItems:"center",gap:10}}><a href="/" className="pill" style={{textDecoration:"none"}}>← Dashboard</a><span className="badge">SUPERVISED • NO EXECUTION</span></div></header>
    <section className="hero"><div className="eyebrow">AGENT RUN</div><h1>Give the agent a mission. Let the agent do the research.</h1><p>You provide the business objective and constraints. The agent decides that research is needed, performs it, records the findings and creates the next validation work. You do not manually complete research tasks.</p><div className="notice"><strong>Owner boundary:</strong> this run can research and recommend validation. It cannot contact businesses, create accounts, spend money, accept terms or take irreversible actions.</div></section>
    <section className="section card"><div className="eyebrow">01 · OWNER MISSION</div><h2>What should the agent accomplish?</h2><label className="muted">Business objective</label><textarea value={goal} onChange={e=>setGoal(e.target.value)} style={{width:"100%",minHeight:110,marginTop:8,padding:12,borderRadius:10,border:"1px solid #334155",background:"#08111f",color:"#eef2ff"}} /><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}><div><label className="muted">Market scope</label><select value={marketScope} onChange={e=>setMarketScope(e.target.value)} style={{width:"100%",marginTop:8,padding:11,borderRadius:10,border:"1px solid #334155",background:"#08111f",color:"#eef2ff"}}><option>Global</option><option>South Africa</option><option>United States</option><option>United Kingdom</option><option>Australia</option><option>Canada</option><option>Specific country or city</option></select></div><div><label className="muted">Current control boundary</label><div className="next" style={{marginTop:8}}>RESEARCH + VALIDATION PLANNING<br/><span className="muted">Owner approval remains required before consequential execution.</span></div></div></div><button className="button" style={{marginTop:16}} onClick={run} disabled={loading}>{loading?"Agent is working…":"Start agent run"}</button>{error&&<div className="notice" style={{marginTop:14}}><strong>Agent run not completed:</strong> {error}</div>}{runInfo&&<div className="notice" style={{marginTop:14}}><strong>Agent completed research.</strong> Run {runInfo.researchRunId||"recorded"} · {runInfo.opportunitiesCreated} opportunity record(s) created/updated for this test run.</div>}</section>
    {summary&&<section className="section card"><div className="eyebrow">02 · AGENT RESEARCH OUTPUT</div><h2>What the agent found</h2><p className="muted">{summary}</p></section>}
    {candidates.length>0&&<section className="section"><div className="eyebrow">03 · AGENT ASSESSMENT</div><h2>Opportunities the agent identified</h2><p className="muted">“Pursuit priority” is a research-based prioritization aid, not a guarantee of success. Weak or conflicting evidence lowers confidence.</p><div className="cards">{candidates.map((c,i)=><article className="card" key={String(c.name||"candidate")+i}><div className="op-top"><span className="pill">Priority {Math.round(Number(c.pursuit_priority ?? c.pursuitPriority)||0)}/100</span><span className="muted">Confidence {Math.round(Number(c.confidence)||0)}%</span></div><h3>{String(c.name||"Unnamed opportunity")}</h3><div className="muted">{String(c.opportunity_type||c.opportunityType||"")} · {String(c.market||"")}</div><p>{String(c.rationale||"")}</p><div className="next"><strong>Demand:</strong> {String(c.demand_evidence||c.demandEvidence||"")}</div><div className="next"><strong>Access:</strong> {String(c.access_evidence||c.accessEvidence||"")}</div><div className="next"><strong>Economics:</strong> {String(c.economics_evidence||c.economicsEvidence||"")}</div><div className="next"><strong>Repeatability:</strong> {String(c.repeatability_evidence||c.repeatabilityEvidence||"")}</div><div className="next"><strong>Risk:</strong> {String(c.risk_evidence||c.riskEvidence||"")}</div><div className="next"><strong>Next validation:</strong> {String(c.next_validation||c.nextValidation||"")}</div></article>)}</div>{sourceUrls.length>0&&<div className="card" style={{marginTop:16}}><strong>Sources captured by research</strong><p className="muted" style={{marginTop:6}}>Research-provider URLs are retained for evidence/audit purposes.</p>{sourceUrls.map((u,j)=><div key={u+j} className="source"><a href={u} target="_blank" rel="noreferrer">{u}</a></div>)}</div>}</section>}
    <section className="section card"><div className="eyebrow">04 · WHAT HAPPENS NEXT</div><h2>Agent continues from the ledger</h2><p className="muted">The research result is now part of the live Operations, Evidence and Scoring views. The next validation task is agent-managed. Return to the dashboard to review the state and any owner decision that requires you.</p><a href="/" className="button" style={{display:"inline-block",textDecoration:"none",marginTop:10}}>Return to Owner Dashboard</a></section>
  </main>
}
