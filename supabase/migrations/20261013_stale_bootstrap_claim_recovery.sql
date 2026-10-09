-- Fail closed on abandoned bootstrap task claims.
-- A stale claim is marked FAILED for review, never reset to READY automatically,
-- because an external provider may have accepted the work before the worker crashed.
create or replace function public.expire_stale_bootstrap_claims(p_stale_minutes integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  if p_stale_minutes is null or p_stale_minutes < 30 or p_stale_minutes > 1440 then
    return jsonb_build_object(
      'ok', false,
      'expiredCount', 0,
      'reason', 'Stale threshold must be between 30 and 1440 minutes.'
    );
  end if;

  update public.bootstrap_tasks
     set status = 'FAILED',
         updated_at = now(),
         notes = coalesce(notes, '') ||
           ' [Stale execution claim expired after ' || p_stale_minutes ||
           ' minutes. External provider outcome must be reconciled before any retry; task was not re-queued automatically.]'
   where status = 'IN_PROGRESS'
     and coalesce(updated_at, started_at, created_at) < now() - make_interval(mins => p_stale_minutes);

  get diagnostics affected = row_count;

  return jsonb_build_object(
    'ok', true,
    'expiredCount', affected,
    'staleAfterMinutes', p_stale_minutes,
    'note', 'Stale claims are marked FAILED for review and are never automatically retried.'
  );
end;
$$;

revoke all on function public.expire_stale_bootstrap_claims(integer) from public;
grant execute on function public.expire_stale_bootstrap_claims(integer) to service_role;
