-- Autonomous Business Agent: persistent ledger schema
create extension if not exists pgcrypto;

create table if not exists opportunities (
  id text primary key,
  name text not null,
  model text not null,
  capital text not null,
  status text not null,
  why text not null,
  next_action text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  title text not null,
  status text not null check (status in ('READY','IN PROGRESS','BLOCKED','COMPLETE')),
  opportunity_id text not null references opportunities(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  tier text not null check (tier in ('T1','T2','T3')),
  status text not null check (status in ('PENDING','APPROVED','REJECTED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists evidence (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text not null references opportunities(id) on delete cascade,
  type text not null,
  claim text not null,
  source text not null,
  checked_on date not null,
  quality text not null check (quality in ('UNVERIFIED','CHECKED','STRONG')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists opportunity_verification (
  opportunity_id text primary key references opportunities(id) on delete cascade,
  demand text not null default 'UNVERIFIED',
  access text not null default 'UNVERIFIED',
  margin text not null default 'UNVERIFIED',
  repeatability text not null default 'UNVERIFIED',
  risk text not null default 'UNVERIFIED',
  updated_at timestamptz not null default now()
);

create index if not exists tasks_opportunity_idx on tasks(opportunity_id);
create index if not exists evidence_opportunity_idx on evidence(opportunity_id);
create index if not exists approvals_status_idx on approvals(status);
