begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

-- Fee assembly at order creation, exercised through the real
-- create_pending_order_and_reserve_inventory RPC.
--
-- Seed FK rows reused (same set 025/026 order-function tests use): customer
-- aaaaaaaa-...-aaa1, campus 1111..., vendor 3111... (Jollof owner, all-day slot
-- availability), slot 5111...113, location 2211...111, zone 2111...111. Menu item
-- 6111...111 (Jollof, price 80000, no required soup) has generated inventory for
-- current_date + n across the horizon at slot 5111...113, so a real RPC call succeeds.
--
-- campus_zones.delivery_fee_kobo is NOT NULL default 15000 and the seed does not override it.
-- The migration-time zone bump runs before the seed loads, so the seed zone is still 15000 at
-- test time. Apply the production bump here so the base is the ₦300 (30000 kobo) the fee model
-- charges. With a non-null zone fee, coalesce takes the zone value; the point path then adds
-- the fee_point_surcharge_kobo setting (10000) on top.
update public.campus_zones set delivery_fee_kobo = 30000
where id = '21111111-1111-1111-1111-111111111111';

-- 1. Non-point order: delivery fee is the ₦300 base only (p_point_delivery => false).
create temp table _base_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 2,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
  'pgtap-fee-base',
  'hash-fee-base',
  p_point_delivery => false
) as order_id;

select is(
  (select delivery_fee_kobo from public.orders where id = (select order_id from _base_order)),
  30000,
  'a non-point order is charged the 30000 base delivery fee'
);

-- 2 + 3. Point order (p_point_delivery => true): delivery fee is base + 10000 point surcharge,
-- and the unchanged total formula picks up the surcharge automatically.
create temp table _point_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 3,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
  'pgtap-fee-point',
  'hash-fee-point',
  p_point_delivery => true
) as order_id;

select is(
  (select delivery_fee_kobo from public.orders where id = (select order_id from _point_order)),
  40000,
  'a point-delivery order is charged the 30000 base plus the 10000 point surcharge'
);

-- orders_total_formula: total = food + delivery + service_fee + large_order_surcharge - discount.
-- The fee change feeds delivery only; the total math is untouched, so for this order:
-- 80000 food + 40000 delivery + 0 service_fee + 0 surcharge - 0 discount = 120000.
select is(
  (select total_kobo from public.orders where id = (select order_id from _point_order)),
  120000,
  'the point-delivery total is food(80000) + delivery(40000) + service_fee(0) + surcharge(0) - discount(0)'
);

select * from finish();
rollback;
