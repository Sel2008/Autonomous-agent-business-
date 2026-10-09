-- Serialize paid-bootstrap-earning ledger writes per task.
-- Apply this migration before deploying worker code that calls the RPC.
create or replace function public.record_bootstrap_paid_earning(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  paid_task public.bootstrap_tasks%rowtype;
  existing_id uuid;
  earning_amount numeric;
begin
  -- Lock the source task so overlapping heartbeats cannot both create a ledger row.
  select *
    into paid_task
    from public.bootstrap_tasks
   where id = p_task_id
     and status = 'PAID'
     and payout_status = 'PAID'
   for update;

  if not found then
    return jsonb_build_object(
      'recorded', false,
      'reason', 'Task is not confirmed PAID.'
    );
  end if;

  earning_amount := coalesce(paid_task.net_amount, 0);
  if earning_amount <= 0 then
    return jsonb_build_object(
      'recorded', false,
      'reason', 'Net payout must be greater than zero.'
    );
  end if;

  select id
    into existing_id
    from public.capital_transactions
   where source_task_id = p_task_id
     and kind = 'EARNING'
   limit 1;

  if existing_id is not null then
    return jsonb_build_object(
      'recorded', false,
      'duplicate', true,
      'transactionId', existing_id::text
    );
  end if;

  insert into public.capital_transactions (
    kind,
    amount,
    currency,
    status,
    reference,
    source_task_id,
    notes
  ) values (
    'EARNING',
    earning_amount,
    coalesce(nullif(paid_task.currency, ''), 'ZAR'),
    'CONFIRMED',
    coalesce(nullif(paid_task.external_task_id, ''), paid_task.id::text),
    paid_task.id,
    'Confirmed bootstrap payout recorded by atomic database RPC.'
  );

  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.record_bootstrap_paid_earning(uuid) from public;
grant execute on function public.record_bootstrap_paid_earning(uuid) to service_role;
