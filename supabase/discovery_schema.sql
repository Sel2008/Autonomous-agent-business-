-- Autonomous Business Agent: discovery + research ledger
create table if not exists discovery_runs (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  market_scope text not null,
  mode text not null default 'RESEARCH_ONLY' check (mode in ('RESEARCH_ONLY','OWNER_APPROVAL_EXECUTION')),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','COMPLETE','FAILED')),
  summary text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists research_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references discovery_runs(id) on delete cascade,
  name text not null,
  opportunity_type text not null default '',
  market text not null default '',
  rationale text not null default '',
  pursuit_priority integer not null default 0 check (pursuit_priority between 0 and 100),
  confidence integer not null default 0 check (confidence between 0 and 100),
  demand_evidence text not null default '',
  access_evidence text not null default '',
  economics_evidence text not null default '',
  repeatability_evidence text not null default '',
  risk_evidence text not null default '',
  risks text not null default '',
  next_validation text not null default '',
  source_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists discovery_runs_created_idx on discovery_runs(created_at desc);
create index if not exists research_candidates_run_idx on research_candidates(run_id);
