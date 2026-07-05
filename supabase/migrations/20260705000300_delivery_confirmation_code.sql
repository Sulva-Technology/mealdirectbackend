-- Delivery confirmation code: rider marks an order delivered by entering a short
-- code the customer reads out on hand-off. Scope is deliberately narrow -- a 4-digit
-- code is only safe because a match is constrained to one rider's currently
-- out-for-delivery orders and brute force is rate limited per rider.

alter table public.orders
  add column delivery_code text;

comment on column public.orders.delivery_code is
  'Short hand-off code the customer reads to the rider to confirm delivery. Assigned when the order goes out for delivery; unique among the rider''s concurrently out-for-delivery orders.';

alter table public.orders
  add constraint orders_delivery_code_format
  check (delivery_code is null or delivery_code ~ '^[0-9]{4}$');

-- Per-rider brute-force guard for delivery-code confirmation attempts.
create table public.rider_delivery_code_attempts (
  rider_id uuid primary key references public.riders(id) on delete cascade,
  failed_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.rider_delivery_code_attempts is
  'Rolling failed-attempt counter that rate limits delivery-code confirmation per rider.';

-- Operational guard data: keep private. RLS is enabled with no anon/authenticated grants
-- or policies, so only the privileged application role (which bypasses RLS) can touch it.
alter table public.rider_delivery_code_attempts enable row level security;

-- Records one failed delivery-code attempt and returns the resulting counter state.
-- Resets the rolling window when it has expired; locks the rider once the attempt
-- ceiling is reached inside an active window.
create or replace function public.register_delivery_code_failure(p_rider_id uuid)
returns table (failed_count integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window constant interval := interval '15 minutes';
  v_max constant integer := 5;
  v_count integer;
  v_window_start timestamptz;
  v_locked timestamptz;
begin
  select a.failed_count, a.window_started_at, a.locked_until
    into v_count, v_window_start, v_locked
  from public.rider_delivery_code_attempts a
  where a.rider_id = p_rider_id
  for update;

  if not found then
    insert into public.rider_delivery_code_attempts (rider_id, failed_count, window_started_at)
    values (p_rider_id, 1, now());
    return query select 1, null::timestamptz;
    return;
  end if;

  if v_window_start < now() - v_window then
    v_count := 0;
    v_window_start := now();
  end if;

  v_count := v_count + 1;
  if v_count >= v_max then
    v_locked := now() + v_window;
  else
    v_locked := null;
  end if;

  update public.rider_delivery_code_attempts
  set failed_count = v_count,
      window_started_at = v_window_start,
      locked_until = v_locked,
      updated_at = now()
  where rider_id = p_rider_id;

  return query select v_count, v_locked;
end;
$$;

comment on function public.register_delivery_code_failure(uuid) is
  'Increments the per-rider delivery-code failure counter and returns the new count and lock expiry.';

-- Clears the failure counter after a successful confirmation.
create or replace function public.reset_delivery_code_attempts(p_rider_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rider_delivery_code_attempts where rider_id = p_rider_id;
$$;

comment on function public.reset_delivery_code_attempts(uuid) is
  'Clears the per-rider delivery-code failure counter after a successful confirmation.';
