-- Autonomous Business Agent: bootstrap earnings + capital ledger
-- Apply after the existing schema files. These tables are intentionally separate
-- from business revenue so earned bootstrap funds are never confused with sales.

create table if not exists capital_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  account_role text not null check (account_role in ('RECEIVING','SPENDING','BOTH')),
  currency text not null default 'ZAR',
  connected boolean not null default false,
  owner_approved boolean not null default false,
  balance numeric(14,2) not null default 0,
  pending_balance numeric(14,2) not null default 0,
  withdrawable_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bootstrap_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  provider text not null,
  source_url text not null default '',
  work_type text not null default '',
  payout_description text not null default '',
  estimated_payout numeric(14,2) not null default 0,
  currency text not null default 'ZAR',
  upfront_cost numeric(14,2) not null default 0,
  automation_allowed boolean not null default false,
  eligibility_verified boolean not null default false,
  payout_verified boolean not null default false,
  risk_status text not null default 'UNVERIFIED' check (risk_status in ('UNVERIFIED','REVIEW','PASS','BLOCKED')),
  status text not null default 'DISCOVERED' check (status in ('DISCOVERED','VERIFIED','READY','ACTIVE','PAUSED','COMPLETE','BLOCKED')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bootstrap_tasks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references bootstrap_opportunities(id) on delete cascade,
  external_task_id text not null default '',
  title text not null,
  status text not null default 'READY' check (status in ('READY','IN_PROGRESS','SUBMITTED','PENDING_PAYOUT','PAID','FAILED','BLOCKED')),
  gross_amount numeric(14,2) not null default 0,
  fees numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  currency text not null default 'ZAR',
  payout_status text not null default 'NOT_STARTED' check (payout_status in ('NOT_STARTED','PENDING','PAID','FAILED')),
  started_at timestamptz,
  completed_at timestamptz,
  paid_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists capital_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references capital_accounts(id) on delete set null,
  kind text not null check (kind in ('EARNING','FEE','DEPOSIT','WITHDRAWAL','FUNDING_ALLOCATION','REFUND','ADJUSTMENT')),
  amount numeric(14,2) not null,
  currency text not null default 'ZAR',
  status text not null default 'RECORDED' check (status in ('RECORDED','PENDING','CONFIRMED','FAILED')),
  reference text not null default '',
  source_task_id uuid references bootstrap_tasks(id) on delete set null,
  owner_approval_id uuid references approvals(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists funding_requests (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text not null references opportunities(id) on delete cascade,
  requested_amount numeric(14,2) not null,
  currency text not null default 'ZAR',
  reason text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','PENDING_APPROVAL','APPROVED','REJECTED','FUNDED','FAILED')),
  source text not null default 'BOOTSTRAP_CAPITAL',
  owner_approval_id uuid references approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  funded_at timestamptz
);

create index if not exists bootstrap_opportunities_status_idx on bootstrap_opportunities(status);
create index if not exists bootstrap_tasks_status_idx on bootstrap_tasks(status);
create index if not exists capital_transactions_created_idx on capital_transactions(created_at desc);
create index if not exists funding_requests_status_idx on funding_requests(status);
