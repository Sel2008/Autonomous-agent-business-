-- Atomically claim a READY bootstrap task before external execution.
-- Overlapping heartbeats cannot execute the same task twice.
create or replace function public.claim_bootstrap_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.bootstrap_tasks%rowtype;
begin
  update public.bootstrap_tasks
     set status = 'IN_PROGRESS',
         started_at = coalesce(started_at, now()),
         updated_at = now(),
         notes = coalesce(notes, '') ||
           ' [Execution claimed atomically by one heartbeat; duplicate claims are rejected.]'
   where id = p_task_id
     and status = 'READY'
  returning * into claimed;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'Task is no longer READY.');
  end if;

  return jsonb_build_object('claimed', true, 'taskId', claimed.id::text, 'status', claimed.status);
end;
$$;

revoke all on function public.claim_bootstrap_task(uuid) from public;
grant execute on function public.claim_bootstrap_task(uuid) to service_role;
