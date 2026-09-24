import { NextResponse } from "next/server";
import { getNextAction } from "../../../lib/agent-core";
import { supabaseConfigured, supabaseRequest } from "../../../lib/supabase";

const fallback = {
  tasks: [
    { id:"t1", title:"Verify the first zero-capital business workflow", status:"READY", opportunity_id:"lead-research" },
    { id:"t2", title:"Define evidence for opportunity verification", status:"READY", opportunity_id:"lead-research" },
    { id:"t3", title:"Select the first micro-service to prototype", status:"READY", opportunity_id:"micro-service" }
  ],
  approvals: [],
  verification: {}
};

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ configured:false, action:getNextAction(fallback) });
  }

  try {
    const [tasks, approvals, verification] = await Promise.all([
      supabaseRequest("tasks?select=*&order=id"),
      supabaseRequest("approvals?select=*&order=created_at.desc"),
      supabaseRequest("opportunity_verification?select=*")
    ]);

    const grouped: Record<string, Record<string, string>> = {};
    for (const row of verification) {
      const opportunityId = row.opportunity_id;
      grouped[opportunityId] = {
        ...(grouped[opportunityId] || {}),
        demand: row.demand,
        access: row.access,
        margin: row.margin,
        repeatability: row.repeatability,
        risk: row.risk
      };
    }

    return NextResponse.json({
      configured:true,
      action:getNextAction({ tasks, approvals, verification:grouped })
    });
  } catch {
    return NextResponse.json({ configured:false, action:getNextAction(fallback) });
  }
}
