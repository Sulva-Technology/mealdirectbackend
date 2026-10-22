begin;

-- On-demand withdrawals: vendors and riders request their own payout from the app instead of
-- waiting for an admin-generated daily settlement and the next-morning pay-run.
--
-- A withdrawal is an ordinary settlement row (kind = 'on_demand', status = 'approved') whose
-- lines are the not-yet-settled per-order earnings past a short hold. It is paid immediately by
-- the existing Paystack transfer path (payout_transfers + reconcile_payout_transfer), so the
-- admin payout queue, webhook and reconcile sweep all keep working unchanged.
--
-- Double-pay safety rests on per-order lines: an order line is withdrawable only while no
-- non-cancelled settlement of the same beneficiary already carries that (order, line_type).
-- Daily settlements are blocked from the cutover date onward so the two paths never overlap.

-- 1) Settlement kind. Existing rows are daily settlements.
alter table public.settlements
  add column if not exists kind text not null default 'daily'
    check (kind in ('daily', 'on_demand'));

comment on column public.settlements.kind is 'daily = admin-generated per-day settlement; on_demand = withdrawal requested by the vendor or rider from the app.';

-- 2) One daily settlement per beneficiary per day still holds; on-demand withdrawals may happen
--    several times a day. The daily producers below are re-created with the matching
--    ON CONFLICT predicate.
drop index public.settlements_vendor_date_unique;
drop index public.settlements_rider_date_unique;
create unique index settlements_vendor_date_unique on public.settlements (vendor_id, settlement_date)
  where vendor_id is not null and kind = 'daily';
create unique index settlements_rider_date_unique on public.settlements (rider_id, settlement_date)
  where rider_id is not null and kind = 'daily';

-- The "already settled?" probe runs per order line.
create index if not exists settlement_lines_order_type_idx
  on public.settlement_lines (order_id, line_type)
  where order_id is not null;

-- 3) Settings. The cutover date defaults to the day this migration runs (Lagos time): orders
--    served from that day are withdrawable on demand; earlier days stay on the daily path so
--    any backlog is settled exactly as before. Clearing the key turns on-demand off.
insert into public.platform_settings (key, value, description)
values
  (
    'on_demand_payouts_start_date',
    to_jsonb(to_char((now() at time zone 'Africa/Lagos')::date, 'YYYY-MM-DD')),
    'Service date (YYYY-MM-DD) from which vendor/rider earnings are paid by on-demand withdrawal instead of daily settlements.'
  ),
  ('withdrawal_hold_minutes', to_jsonb(120), 'Minutes after delivery before an order''s earnings can be withdrawn (room for complaints and refunds).'),
  ('withdrawal_min_kobo', to_jsonb(100000), 'Smallest on-demand withdrawal, in kobo.')
on conflict (key) do nothing;

create or replace function public.on_demand_payouts_start_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (
    select case
      when jsonb_typeof(s.value) = 'string' and (s.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
        then (s.value #>> '{}')::date
    end
    from public.platform_settings s
    where s.key = 'on_demand_payouts_start_date'
  );
$$;

comment on function public.on_demand_payouts_start_date() is 'Cutover date for on-demand withdrawals, or null (on-demand off) when the setting is missing or malformed.';

-- 4) Withdrawable lines. p_completed_before is the hold cut-off: pass now() - hold for what can
--    be withdrawn now, or now() to include earnings still inside the hold.
--    Vendor credits mirror produce_vendor_daily_settlement per order; succeeded refunds are
--    deducted as soon as they land (no hold), net of refund lines already settled, so a refund
--    on an order that was already withdrawn comes off the next withdrawal.
create or replace function public.vendor_withdrawable_lines(
  p_vendor_id uuid,
  p_completed_before timestamptz
)
returns table (order_id uuid, line_type text, amount_kobo integer, description text)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select o.id, o.order_number, o.order_status, o.food_subtotal_kobo,
           coalesce(o.vendor_delivery_share_kobo, 0) as vendor_delivery_share_kobo,
           o.service_fee_kobo
    from public.orders o
    where o.vendor_id = p_vendor_id
      and o.service_date >= public.on_demand_payouts_start_date()
      and o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
      and coalesce(o.delivered_at, o.confirmed_at, o.updated_at) <= p_completed_before
  ),
  credits as (
    select e.id as order_id, 'food'::text as line_type, e.food_subtotal_kobo as amount_kobo,
           'Food subtotal for ' || e.order_number as description
    from eligible e
    union all
    select e.id, 'vendor_delivery', e.vendor_delivery_share_kobo,
           'Vendor delivery share for ' || e.order_number
    from eligible e
    where e.order_status <> 'refunded'
    union all
    select e.id, 'service_fee', e.service_fee_kobo, 'Takeaway service fee for ' || e.order_number
    from eligible e
  ),
  refunded as (
    select r.order_id, o.order_number, sum(r.amount_kobo)::integer as refunded_kobo
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.vendor_id = p_vendor_id
      and o.service_date >= public.on_demand_payouts_start_date()
      and r.status = 'succeeded'
    group by r.order_id, o.order_number
  ),
  refund_lines as (
    select rf.order_id, 'refund'::text as line_type,
           -(rf.refunded_kobo - coalesce(settled.kobo, 0)) as amount_kobo,
           'Refund for ' || rf.order_number as description
    from refunded rf
    left join lateral (
      select -sum(sl.amount_kobo)::integer as kobo
      from public.settlement_lines sl
      join public.settlements s on s.id = sl.settlement_id
      where sl.order_id = rf.order_id
        and sl.line_type = 'refund'
        and s.vendor_id = p_vendor_id
        and s.status <> 'cancelled'
    ) settled on true
  )
  select c.order_id, c.line_type, c.amount_kobo, c.description
  from credits c
  where c.amount_kobo > 0
    and not exists (
      select 1
      from public.settlement_lines sl
      join public.settlements s on s.id = sl.settlement_id
      where sl.order_id = c.order_id
        and sl.line_type = c.line_type
        and s.vendor_id = p_vendor_id
        and s.status <> 'cancelled'
    )
  union all
  select rl.order_id, rl.line_type, rl.amount_kobo, rl.description
  from refund_lines rl
  where rl.amount_kobo < 0;
$$;

comment on function public.vendor_withdrawable_lines(uuid, timestamptz) is 'Per-order vendor earnings (food, delivery share, service fee) completed before the cut-off and not yet in a live settlement, plus unsettled refund deductions.';

create or replace function public.rider_withdrawable_lines(
  p_rider_id uuid,
  p_completed_before timestamptz
)
returns table (order_id uuid, line_type text, amount_kobo integer, description text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, 'rider_delivery'::text, coalesce(o.rider_delivery_share_kobo, 0),
         'Rider delivery share for ' || o.order_number
  from public.delivery_assignments da
  join public.delivery_batch_orders dbo on dbo.batch_id = da.batch_id
  join public.orders o on o.id = dbo.order_id
  where da.rider_id = p_rider_id
    and o.service_date >= public.on_demand_payouts_start_date()
    and o.delivery_mode = 'meal_direct_rider'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
    and coalesce(o.rider_delivery_share_kobo, 0) > 0
    and coalesce(o.delivered_at, o.confirmed_at, o.updated_at) <= p_completed_before
    and not exists (
      select 1
      from public.settlement_lines sl
      join public.settlements s on s.id = sl.settlement_id
      where sl.order_id = o.id
        and sl.line_type = 'rider_delivery'
        and s.rider_id = p_rider_id
        and s.status <> 'cancelled'
    );
$$;

comment on function public.rider_withdrawable_lines(uuid, timestamptz) is 'Per-order rider delivery shares completed before the cut-off and not yet in a live settlement.';

-- 5) Create a withdrawal. Exactly one of p_vendor_id / p_rider_id. Returns one row:
--      outcome 'created'            -> settlement_id + amount_kobo, ready for the transfer
--      outcome 'disabled'           -> on-demand cutover date not set
--      outcome 'no_payout_account'  -> no admin-approved payout account with a recipient code
--      outcome 'below_minimum'      -> amount_kobo is the withdrawable amount, below the minimum
--    The beneficiary row is locked so two taps on "Withdraw" can never claim the same lines.
create or replace function public.request_withdrawal(
  p_vendor_id uuid,
  p_rider_id uuid,
  p_requested_by uuid
)
returns table (outcome text, settlement_id uuid, amount_kobo integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_cutoff timestamptz;
  v_min integer;
  v_available integer;
  v_settlement_id uuid;
  v_food integer;
  v_delivery integer;
  v_service integer;
  v_refunds integer;
  v_lines jsonb;
begin
  if (p_vendor_id is null) = (p_rider_id is null) then
    raise exception 'exactly one of vendor or rider is required' using errcode = '22023';
  end if;

  if public.on_demand_payouts_start_date() is null then
    return query select 'disabled'::text, null::uuid, 0;
    return;
  end if;

  if p_vendor_id is not null then
    select v.campus_id into v_campus_id from public.vendors v where v.id = p_vendor_id for update;
    if v_campus_id is null then
      raise exception 'vendor % not found', p_vendor_id using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.vendor_payout_accounts vpa
      where vpa.vendor_id = p_vendor_id
        and vpa.active
        and vpa.paystack_recipient_code is not null
        and vpa.admin_review_status = 'approved'
    ) then
      return query select 'no_payout_account'::text, null::uuid, 0;
      return;
    end if;
  else
    select r.campus_id into v_campus_id from public.riders r where r.id = p_rider_id for update;
    if v_campus_id is null then
      raise exception 'rider % not found', p_rider_id using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.rider_payout_accounts rpa
      where rpa.rider_id = p_rider_id
        and rpa.active
        and rpa.paystack_recipient_code is not null
        and rpa.admin_review_status = 'approved'
    ) then
      return query select 'no_payout_account'::text, null::uuid, 0;
      return;
    end if;
  end if;

  v_cutoff := now() - make_interval(mins => public.platform_setting_int('withdrawal_hold_minutes', 120));
  v_min := public.platform_setting_int('withdrawal_min_kobo', 100000);

  -- Snapshot the lines once so the settlement totals and its lines can never disagree, even if
  -- a refund lands while this runs.
  if p_vendor_id is not null then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines
    from public.vendor_withdrawable_lines(p_vendor_id, v_cutoff) l;
  else
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines
    from public.rider_withdrawable_lines(p_rider_id, v_cutoff) l;
  end if;

  select
    coalesce(sum(wl.amount_kobo) filter (where wl.line_type = 'food'), 0),
    coalesce(sum(wl.amount_kobo) filter (where wl.line_type in ('vendor_delivery', 'rider_delivery')), 0),
    coalesce(sum(wl.amount_kobo) filter (where wl.line_type = 'service_fee'), 0),
    coalesce(-sum(wl.amount_kobo) filter (where wl.line_type = 'refund'), 0)
  into v_food, v_delivery, v_service, v_refunds
  from jsonb_to_recordset(v_lines)
    as wl(order_id uuid, line_type text, amount_kobo integer, description text);

  v_available := v_food + v_delivery + v_service - v_refunds;

  if v_available < greatest(v_min, 1) then
    return query select 'below_minimum'::text, null::uuid, v_available;
    return;
  end if;

  insert into public.settlements (
    campus_id,
    vendor_id,
    rider_id,
    settlement_date,
    kind,
    status,
    gross_food_amount_kobo,
    delivery_earnings_kobo,
    service_fee_kobo,
    refunds_kobo,
    payable_kobo,
    created_by
  )
  values (
    v_campus_id,
    p_vendor_id,
    p_rider_id,
    (now() at time zone 'Africa/Lagos')::date,
    'on_demand',
    'approved',
    v_food,
    v_delivery,
    v_service,
    v_refunds,
    v_available,
    p_requested_by
  )
  returning id into v_settlement_id;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, wl.order_id, wl.line_type, wl.amount_kobo, wl.description
  from jsonb_to_recordset(v_lines)
    as wl(order_id uuid, line_type text, amount_kobo integer, description text);

  return query select 'created'::text, v_settlement_id, v_available;
end;
$$;

comment on function public.request_withdrawal(uuid, uuid, uuid) is 'Creates an approved on-demand settlement from the beneficiary''s withdrawable lines (past the hold, not yet settled) when it meets the minimum and an approved payout account exists.';

-- 6) Transfer reconcile: unchanged for daily settlements. A failed or reversed transfer on an
--    on-demand withdrawal cancels it, which releases its lines back to the withdrawable balance
--    so the beneficiary can simply request again (after fixing their bank details if needed).
create or replace function public.reconcile_payout_transfer(
  p_reference text,
  p_status text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
begin
  update public.payout_transfers
  set status = p_status,
      provider_payload = p_payload
  where reference = p_reference
  returning settlement_id into v_settlement_id;

  if v_settlement_id is null then
    return;
  end if;

  if p_status = 'success' then
    update public.settlements
    set status = 'paid',
        paid_at = coalesce(paid_at, now())
    where id = v_settlement_id;
  elsif p_status in ('failed', 'reversed') then
    update public.settlements
    set status = 'cancelled'
    where id = v_settlement_id
      and kind = 'on_demand'
      and status in ('approved', 'paid');
  end if;
end;
$$;

comment on function public.reconcile_payout_transfer(text, text, jsonb) is 'Updates a payout transfer status by reference; marks the settlement paid on success, and cancels an on-demand withdrawal on failure/reversal so its earnings return to the withdrawable balance.';

-- 7) Daily producers: re-created verbatim from 20260728000600_settlement_resolved_shares.sql.
--    The ONLY changes are the cutover guard at the top and the ON CONFLICT predicate, which
--    now names the partial daily unique index (… and kind = 'daily').

create or replace function public.produce_rider_daily_settlement(
  p_rider_id uuid,
  p_settlement_date date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_settlement_id uuid;
  v_delivery integer;
begin
  -- On-demand cutover: from on_demand_payouts_start_date onward, earnings are paid through
  -- request_withdrawal. A daily settlement for those dates would pay the same orders twice.
  if public.on_demand_payouts_start_date() is not null
     and p_settlement_date >= public.on_demand_payouts_start_date() then
    raise exception 'Daily settlements are off from %: vendors and riders now withdraw on demand.',
      public.on_demand_payouts_start_date()
      using errcode = '23514';
  end if;

  select campus_id into v_campus_id from public.riders where id = p_rider_id;
  if v_campus_id is null then
    raise exception 'rider % not found', p_rider_id using errcode = 'P0002';
  end if;

  select coalesce(sum(coalesce(o.rider_delivery_share_kobo, 0)), 0)
  into v_delivery
  from public.delivery_assignments da
  join public.delivery_batch_orders dbo on dbo.batch_id = da.batch_id
  join public.orders o on o.id = dbo.order_id
  where da.rider_id = p_rider_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'meal_direct_rider'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed');

  insert into public.settlements (
    campus_id,
    rider_id,
    settlement_date,
    delivery_earnings_kobo,
    payable_kobo,
    created_by
  )
  values (
    v_campus_id,
    p_rider_id,
    p_settlement_date,
    v_delivery,
    v_delivery,
    p_created_by
  )
  on conflict (rider_id, settlement_date) where rider_id is not null and kind = 'daily'
  do update set
    delivery_earnings_kobo = excluded.delivery_earnings_kobo,
    payable_kobo = excluded.payable_kobo,
    updated_at = now()
  returning id into v_settlement_id;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'rider_delivery', coalesce(o.rider_delivery_share_kobo, 0), 'Rider delivery share for ' || o.order_number
  from public.delivery_assignments da
  join public.delivery_batch_orders dbo on dbo.batch_id = da.batch_id
  join public.orders o on o.id = dbo.order_id
  where da.rider_id = p_rider_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'meal_direct_rider'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
  on conflict do nothing;

  return v_settlement_id;
end;
$$;

comment on function public.produce_rider_daily_settlement(uuid, date, uuid) is 'Calculates daily delivery earnings for a Meal Direct rider from assigned completed batches using the resolved per-order rider delivery share.';

create or replace function public.produce_vendor_daily_settlement(
  p_vendor_id uuid,
  p_settlement_date date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_settlement_id uuid;
  v_food integer;
  v_delivery integer;
  v_service integer;
  v_refunds integer;
begin
  -- On-demand cutover: from on_demand_payouts_start_date onward, earnings are paid through
  -- request_withdrawal. A daily settlement for those dates would pay the same orders twice.
  if public.on_demand_payouts_start_date() is not null
     and p_settlement_date >= public.on_demand_payouts_start_date() then
    raise exception 'Daily settlements are off from %: vendors and riders now withdraw on demand.',
      public.on_demand_payouts_start_date()
      using errcode = '23514';
  end if;

  select campus_id into v_campus_id from public.vendors where id = p_vendor_id;
  if v_campus_id is null then
    raise exception 'vendor % not found', p_vendor_id using errcode = 'P0002';
  end if;

  select coalesce(sum(food_subtotal_kobo), 0)
  into v_food
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded');

  select coalesce(sum(coalesce(vendor_delivery_share_kobo, 0)), 0)
  into v_delivery
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and order_status in ('delivered', 'confirmed', 'administratively_completed');

  select coalesce(sum(service_fee_kobo), 0)
  into v_service
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded');

  select coalesce(sum(r.amount_kobo), 0)
  into v_refunds
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and r.status = 'succeeded';

  insert into public.settlements (
    campus_id,
    vendor_id,
    settlement_date,
    gross_food_amount_kobo,
    delivery_earnings_kobo,
    service_fee_kobo,
    refunds_kobo,
    payable_kobo,
    created_by
  )
  values (
    v_campus_id,
    p_vendor_id,
    p_settlement_date,
    v_food,
    v_delivery,
    v_service,
    v_refunds,
    v_food + v_delivery + v_service - v_refunds,
    p_created_by
  )
  on conflict (vendor_id, settlement_date) where vendor_id is not null and kind = 'daily'
  do update set
    gross_food_amount_kobo = excluded.gross_food_amount_kobo,
    delivery_earnings_kobo = excluded.delivery_earnings_kobo,
    service_fee_kobo = excluded.service_fee_kobo,
    refunds_kobo = excluded.refunds_kobo,
    payable_kobo = excluded.payable_kobo,
    updated_at = now()
  returning id into v_settlement_id;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'food', o.food_subtotal_kobo, 'Food subtotal for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
  on conflict do nothing;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'vendor_delivery', coalesce(o.vendor_delivery_share_kobo, 0), 'Vendor delivery share for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
    and coalesce(o.vendor_delivery_share_kobo, 0) > 0
  on conflict do nothing;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'service_fee', o.service_fee_kobo, 'Takeaway service fee for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
    and o.service_fee_kobo > 0
  on conflict do nothing;

  return v_settlement_id;
end;
$$;

comment on function public.produce_vendor_daily_settlement(uuid, date, uuid) is 'Calculates vendor daily food payout, resolved vendor delivery/cooking share (paid in both delivery modes), takeaway service fee reimbursement, refunds, and settlement lines.';

commit;
