-- Atomic, idempotent ZAR funding reservations for the bootstrap heartbeat.
-- Only connected, owner-approved receiving/spending accounts count as confirmed capital.
-- A reservation is bookkeeping only; it never transfers or spends money.

create or replace function public.reserve_queued_funding_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available_zar numeric(14,2) := 0;
  reserved_zar numeric(14,2) := 0;
  newly_reserved jsonb := '[]'::jsonb;
  request_row public.funding_requests%rowtype;
begin
  -- Serialize all heartbeat instances that may reserve the same balance.
  perform pg_advisory_xact_lock(hashtext('autonomous-agent-bootstrap-funding-reservations'));

  select coalesce(sum(greatest(balance, 0)), 0)
    into available_zar
    from public.capital_accounts
   where upper(coalesce(currency, 'ZAR')) = 'ZAR'
     and connected = true
     and owner_approved = true;

  select coalesce(sum(greatest(requested_amount, 0)), 0)
    into reserved_zar
    from public.funding_requests
   where status = 'FUNDED'
     and upper(coalesce(currency, 'ZAR')) = 'ZAR';

  for request_row in
    select *
      from public.funding_requests
     where status = 'QUEUED'
       and upper(coalesce(currency, 'ZAR')) = 'ZAR'
       and requested_amount > 0
     order by created_at asc, id asc
     for update
  loop
    if reserved_zar + request_row.requested_amount <= available_zar then
      update public.funding_requests
         set status = 'FUNDED',
             funded_at = now(),
             reason = coalesce(reason, '') ||
               ' [Capital reserved atomically from connected, owner-approved ZAR balance; no transfer or spend performed.]'
       where id = request_row.id
         and status = 'QUEUED';

      if found then
        reserved_zar := reserved_zar + request_row.requested_amount;
        newly_reserved := newly_reserved || jsonb_build_array(request_row.id::text);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'availableZar', available_zar,
    'reservedZar', reserved_zar,
    'newlyReservedRequests', newly_reserved
  );
end;
$$;

revoke all on function public.reserve_queued_funding_requests() from public;
grant execute on function public.reserve_queued_funding_requests() to service_role;
