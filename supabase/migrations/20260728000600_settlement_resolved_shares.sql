begin;

-- Fee-model migration Task 6: settlements and batch earnings read the RESOLVED per-order
-- delivery shares instead of the flat pilot fulfiller_delivery_share_kobo (7500).
--
-- v2 resolves the delivery fee per order (at the delivered transition, by
-- resolve_order_delivery_shares in 20260728000500) into:
--   * rider_delivery_share_kobo   -- the rider's cut (meal_direct_rider mode)
--   * vendor_delivery_share_kobo  -- the vendor cooking bonus (always) plus the delivery share
--                                    when the order is vendor_delivery
--   * platform_delivery_share_kobo-- residual, absorbs every timing forfeit
--
-- This migration relaxes the flat batch-earnings formula and re-creates the three payout
-- functions to read the resolved columns. Each function below is the newest prior definition
-- copied whole; only the named lines change.
--
-- Note: the plan refers to a "finalize_delivery_batch" function, but no such function exists in
-- this schema. The only function that assigns delivery_batches.delivery_earnings_kobo (via
-- calculate_delivery_earnings) is public.add_paid_order_to_batch (defined in
-- 20260612000400_orders_payments_batches_settlements.sql), so that is the function re-created here.
-- calculate_delivery_earnings itself is left in place: it is still called directly by the pgTAP
-- test 020_orders_payments_test.sql and is granted to roles in 20260612000500.

-- 1) Relax the flat batch-earnings formula. The pilot pinned delivery_earnings_kobo to
--    order_count * 7500; earnings are now the sum of the batch's resolved rider shares, which
--    are variable, so only require non-negativity.
alter table public.delivery_batches drop constraint delivery_batches_earnings_formula;
alter table public.delivery_batches add constraint delivery_batches_earnings_non_negative
  check (delivery_earnings_kobo >= 0);

-- 2) Batch earnings = sum of resolved rider shares in the batch.
--    Re-created verbatim from 20260612000400; the ONLY change is the delivery_earnings_kobo
--    assignment in the final update (was public.calculate_delivery_earnings(batch_counts.order_count)).
create or replace function public.add_paid_order_to_batch(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_batch_id uuid;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if v_order.order_status not in ('paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'confirmed', 'administratively_completed') then
    raise exception 'only paid or operational orders can be batched' using errcode = '23514';
  end if;

  insert into public.delivery_batches (
    campus_id,
    vendor_id,
    service_date,
    delivery_slot_id,
    zone_id,
    batch_number,
    delivery_mode,
    cutoff_at
  )
  values (
    v_order.campus_id,
    v_order.vendor_id,
    v_order.service_date,
    v_order.delivery_slot_id,
    v_order.zone_id,
    'MDB-' || to_char(v_order.service_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_order.delivery_mode,
    public.effective_ordering_cutoff_at(v_order.service_date, v_order.delivery_slot_id)
  )
  on conflict (campus_id, vendor_id, service_date, delivery_slot_id, zone_id, delivery_mode)
  do update set updated_at = now()
  returning id into v_batch_id;

  insert into public.delivery_batch_orders (batch_id, order_id)
  values (v_batch_id, p_order_id)
  on conflict (order_id) do nothing;

  update public.delivery_batches db
  set order_count = batch_counts.order_count,
      delivery_earnings_kobo = (
        select coalesce(sum(o.rider_delivery_share_kobo), 0)
        from public.delivery_batch_orders dbo
        join public.orders o on o.id = dbo.order_id
        where dbo.batch_id = v_batch_id
      )
  from (
    select batch_id, count(*)::integer as order_count
    from public.delivery_batch_orders
    where batch_id = v_batch_id
    group by batch_id
  ) batch_counts
  where db.id = batch_counts.batch_id;

  return v_batch_id;
end;
$$;

comment on function public.add_paid_order_to_batch(uuid) is 'Adds one paid order to its logical delivery batch and recalculates batch delivery earnings as the sum of the batch orders'' resolved rider delivery shares.';

-- 3) Rider settlement: read the resolved rider share.
--    Re-created verbatim from 20260612000400; the ONLY changes are the aggregate SUM and the
--    'rider_delivery' settlement-line amount, both from o.fulfiller_delivery_share_kobo to
--    coalesce(o.rider_delivery_share_kobo, 0).
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
  on conflict (rider_id, settlement_date) where rider_id is not null
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

-- 4) Vendor settlement: the 'vendor_delivery' line pays the resolved vendor share and now applies
--    to BOTH delivery modes so the vendor cooking bonus is paid even when a rider delivered.
--    Re-created verbatim from the NEWEST definition (20260702000100_settlement_service_fee.sql,
--    which folds in the takeaway service fee); the ONLY changes are:
--      - v_delivery aggregate: sum coalesce(o.vendor_delivery_share_kobo, 0) and drop the
--        delivery_mode = 'vendor_delivery' filter;
--      - the 'vendor_delivery' line amount: coalesce(o.vendor_delivery_share_kobo, 0), drop the
--        delivery_mode = 'vendor_delivery' filter, and skip ₦0 vendor shares.
--    The 'food' line and the 'service_fee' line, all aggregates and upserts, are unchanged.
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
  on conflict (vendor_id, settlement_date) where vendor_id is not null
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
