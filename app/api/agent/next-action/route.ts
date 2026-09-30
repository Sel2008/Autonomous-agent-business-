import { NextResponse } from "next/server";
import { getNextAction } from "../../../../lib/agent-core";
import { supabaseConfigured, supabaseRequest } from "../../../../lib/supabase";

const fallback = {
  tasks: [
    { id:"t1", title:"Verify the first zero-capital business workflow", status:"READY", opportunity_id:"lead-research" },
    { id:"t2", title:"Define evidence for opportunity verification", status:"READY", opportunity_id:"lead-research" },
    { id:"t3", title:"Select the first micro-service to prototype", status:"READY", opportunity_id:"micro-service" }
  ],
  approvals: [],
  verification: {}
};

const stateRank: Record<string, number> = { UNVERIFIED: 1, CHECKED: 2, STRONG: 3 };

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ configured:false, action:getNextAction(fallback) });

  try {
    const [tasks, approvals, verification] = await Promise.all([
      supabaseRequest("tasks?select=*&order=id"),
      supabaseRequest("approvals?select=*&order=created_at.desc"),
      supabaseRequest("opportunity_verification?select=*")
    ]);

    const grouped: Record<string, Record<string, string>> = {};
    for (const row of Array.isArray(verification) ? verification : []) {
      const opportunityId = String(row?.opportunity_id || "");
      if (!opportunityId) continue;
      const current = grouped[opportunityId] || {};
      for (const dimension of ["demand","access","margin","repeatability","risk"]) {
        const incoming = String(row?.[dimension] || "UNVERIFIED");
        const existing = current[dimension] || "UNVERIFIED";
        current[dimension] = (stateRank[incoming] || 0) >= (stateRank[existing] || 0) ? incoming : existing;
      }
      grouped[opportunityId] = current;
    }

    return NextResponse.json({
      configured:true,
      action:getNextAction({
        tasks: Array.isArray(tasks) ? tasks : [],
        approvals: Array.isArray(approvals) ? approvals : [],
        verification:grouped
      })
    });
  } catch {
    return NextResponse.json({ configured:false, action:getNextAction(fallback) });
  }
}
