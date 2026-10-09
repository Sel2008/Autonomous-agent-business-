import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseRequest } from "../../../lib/supabase";

const safety=[
 "Never pay money to unlock a task, withdraw earnings, or get a job.",
 "Never deposit crypto to access supposed earnings.",
 "Never buy starter packages, paid access, or mandatory training just to work.",
 "Never perform fake reviews, likes, ratings, clicks, or artificial engagement.",
 "Never bypass a platform's automation rules or pretend to be a human where automation is prohibited.",
 "Never treat projected earnings as revenue; only confirmed payouts enter the capital ledger.",
 "Account connections, withdrawals, transfers, and spending earned funds require owner approval."
];

export async function GET(){
 if(!supabaseConfigured()) return NextResponse.json({configured:false,schemaReady:false,balances:{available:0,pending:0,withdrawable:0,totalEarned:0,today:0,week:0},activeTasks:[],opportunities:[],fundingRequests:[],accounts:[],safety});
 try{
  const [accounts,opps,tasks,txs,requests,approvals]=await Promise.all([
   supabaseRequest("capital_accounts?select=*&order=created_at.asc"),
   supabaseRequest("bootstrap_opportunities?select=*&order=created_at.desc"),
   supabaseRequest("bootstrap_tasks?select=*&order=created_at.desc"),
   supabaseRequest("capital_transactions?select=*&order=created_at.desc"),
   supabaseRequest("funding_requests?select=*&order=created_at.desc"),
   supabaseRequest("approvals?select=*&order=created_at.desc")
  ]);
  const rows=Array.isArray(txs)?txs:[];
  const earnings=rows.filter((x:any)=>String(x?.kind)==="EARNING" && ["RECORDED","CONFIRMED"].includes(String(x?.status||"")));
  const totalEarned=earnings.reduce((s:number,x:any)=>s+Number(x.amount||0),0);
  const now=Date.now(),day=86400000;
  const today=earnings.filter((x:any)=>now-new Date(x.created_at).getTime()<day).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
  const week=earnings.filter((x:any)=>now-new Date(x.created_at).getTime()<7*day).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
  const accts=Array.isArray(accounts)?accounts:[];
  const available=accts.reduce((s:number,x:any)=>s+Number(x.balance||0),0);
  const pending=accts.reduce((s:number,x:any)=>s+Number(x.pending_balance||0),0);
  const withdrawable=accts.reduce((s:number,x:any)=>s+Number(x.withdrawable_balance||0),0);
  const opportunityRows=Array.isArray(opps)?opps:[];
  const requestRows=Array.isArray(requests)?requests:[];
  const oppMap=new Map(opportunityRows.map((x:any)=>[String(x.id),x]));
  return NextResponse.json({
   configured:true,schemaReady:true,
   balances:{available,pending,withdrawable,totalEarned,today,week},
   activeTasks:(Array.isArray(tasks)?tasks:[]).filter((x:any)=>["READY","IN_PROGRESS","SUBMITTED","PENDING_PAYOUT"].includes(String(x.status))),
   opportunities:opportunityRows.filter((x:any)=>["DISCOVERED","VERIFIED","READY","ACTIVE","PAUSED"].includes(String(x.status))),
   fundingRequests:requestRows.map((x:any)=>({...x,opportunity_name:oppMap.get(String(x.opportunity_id))?.name||x.opportunity_id})),
   permissionApprovals:(Array.isArray(approvals)?approvals:[]).filter((x:any)=>String(x.title||"").startsWith("Bootstrap permission review: ")),
   accounts:accts,safety
  });
 }catch(error){
  return NextResponse.json({configured:true,schemaReady:false,balances:{available:0,pending:0,withdrawable:0,totalEarned:0,today:0,week:0},activeTasks:[],opportunities:[],fundingRequests:[],accounts:[],safety,error:error instanceof Error?error.message:"Bootstrap schema is not installed yet."});
 }
}
