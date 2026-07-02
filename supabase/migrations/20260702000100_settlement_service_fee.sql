begin;

-- The ₦200 takeaway/packaging fee (orders.service_fee_kobo, added in
-- 20260625000400_order_service_fee.sql) is charged to the customer and folded into the
-- order total, but produce_vendor_daily_settlement was never recreated to account for it.
-- It is packaging money the vendor lays out, so it must be reimbursed to the vendor.
-- This migration adds settlements.service_fee_kobo, folds it into the payable formula, and
-- recreates produce_vendor_daily_settlement to aggregate it and emit a per-order line.

alter table public.settlements
  add column if not exists service_fee_kobo integer not null default 0;

comment on column public.settlements.service_fee_kobo is 'Sum of per-order takeaway/packaging (service) fees reimbursed to the vendor for the settlement date.';

-- Include the service fee in the non-negative guarantees.
alter table public.settlements drop constraint settlements_amounts_non_negative;
alter table public.settlements add constraint settlements_amounts_non_negative check (
  gross_food_amount_kobo >= 0
  and delivery_earnings_kobo >= 0
  and service_fee_kobo >= 0
  and refunds_kobo >= 0
  and payable_kobo >= 0
);

-- Fold the service fee into the payable formula.
alter table public.settlements drop constraint settlements_payable_formula;
alter table public.settlements add constraint settlements_payable_formula check (
  payable_kobo = gross_food_amount_kobo + delivery_earnings_kobo + service_fee_kobo - refunds_kobo + adjustments_kobo
);

-- Recreate produce_vendor_daily_settlement: identical to the definition in
-- 20260612000400_orders_payments_batches_settlements.sql plus the takeaway service fee.
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

  select coalesce(sum(fulfiller_delivery_share_kobo), 0)
  into v_delivery
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and delivery_mode = 'vendor_delivery'
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
  select v_settlement_id, o.id, 'vendor_delivery', o.fulfiller_delivery_share_kobo, 'Vendor delivery share for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'vendor_delivery'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
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

comment on function public.produce_vendor_daily_settlement(uuid, date, uuid) is 'Calculates vendor daily food payout, vendor-delivery earnings, takeaway service fee reimbursement, refunds, and settlement lines.';

commit;
