begin;

alter table public.outbox_events
  add column if not exists failed_at timestamptz;

create index if not exists outbox_events_failed_idx
  on public.outbox_events (failed_at) where failed_at is not null;

create or replace function public.claim_outbox_batch(p_worker_id text, p_limit integer)
returns setof public.outbox_events
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id from public.outbox_events
    where processed_at is null and failed_at is null
      and locked_at is null and available_at <= now()
    order by available_at asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.outbox_events oe
  set locked_at = now(), locked_by = p_worker_id, attempts = attempts + 1
  from claimed where oe.id = claimed.id
  returning oe.*;
$$;

create or replace function public.complete_outbox_event(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.outbox_events
  set processed_at = now(), locked_at = null, locked_by = null, last_error = null
  where id = p_id;
$$;

create or replace function public.fail_outbox_event(
  p_id uuid, p_error text, p_max_attempts integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.outbox_events where id = p_id;
  if v_attempts >= p_max_attempts then
    update public.outbox_events
    set failed_at = now(), locked_at = null, locked_by = null, last_error = p_error
    where id = p_id;
  else
    update public.outbox_events
    set locked_at = null, locked_by = null, last_error = p_error,
        available_at = now() + (interval '1 second' * power(2, v_attempts))
    where id = p_id;
  end if;
end;
$$;

comment on column public.outbox_events.failed_at is 'Set when event exhausts max_attempts; excludes it from future claim batches (dead-letter).';
comment on function public.claim_outbox_batch(text, integer) is 'Atomically claims up to p_limit available outbox events for a worker, incrementing attempts and setting locked_by/locked_at.';
comment on function public.complete_outbox_event(uuid) is 'Marks an outbox event as successfully processed; clears lock fields.';
comment on function public.fail_outbox_event(uuid, text, integer) is 'Releases the lock on a failed event. If attempts >= p_max_attempts, dead-letters it (failed_at); otherwise backs off with exponential delay on available_at.';

commit;
