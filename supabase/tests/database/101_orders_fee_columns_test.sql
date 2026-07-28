begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

-- 1-7: the seven new resolved-share / readiness / timeliness columns exist.
select has_column('public', 'orders', 'point_delivery', 'orders has point_delivery column');
select has_column('public', 'orders', 'ready_at', 'orders has ready_at column');
select has_column('public', 'orders', 'rider_confirmed_ready', 'orders has rider_confirmed_ready column');
select has_column('public', 'orders', 'rider_delivery_share_kobo', 'orders has rider_delivery_share_kobo column');
select has_column('public', 'orders', 'vendor_delivery_share_kobo', 'orders has vendor_delivery_share_kobo column');
select has_column('public', 'orders', 'ready_on_time', 'orders has ready_on_time column');
select has_column('public', 'orders', 'delivered_on_time', 'orders has delivered_on_time column');

-- 8: an order with delivery_fee_kobo = 30000 now inserts (the flat-15000 pin is gone).
-- Reuses seed FK rows (customer/campus/vendor/slot/location/zone from MD-SEED-PENDING).
-- total_kobo = food + delivery + service_fee(0) + surcharge(0) - discount(0) = 130000.
-- order_status = 'delivered' so the pending-payment insert-cutoff trigger does not fire and
-- no inventory reservation is required. rider/vendor shares left null -> balance unconstrained.
select lives_ok(
  $$ insert into public.orders (
       id, order_number, customer_id, campus_id, vendor_id, service_date,
       delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
       food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo, delivered_at
     ) values (
       'cccccccc-cccc-cccc-cccc-cccccccc0101', 'MD-TEST-FEE-101A',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 1,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       '21111111-1111-1111-1111-111111111111',
       'delivered', 'meal_direct_rider',
       100000, 30000, 0, 130000, now()
     ) $$,
  'a delivered order with a 30000 delivery fee inserts (flat-15000 pin removed)'
);

-- 9: resolved shares that do not sum to delivery_fee_kobo are rejected by
-- orders_resolved_shares_balance with SQLSTATE 23514. Here 10000 + 10000 + 5000 = 25000 != 30000.
-- total_formula and money-non-negative both pass, so the balance check is the sole violation.
select throws_ok(
  $$ insert into public.orders (
       id, order_number, customer_id, campus_id, vendor_id, service_date,
       delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
       food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo,
       platform_delivery_share_kobo, rider_delivery_share_kobo, vendor_delivery_share_kobo, delivered_at
     ) values (
       'cccccccc-cccc-cccc-cccc-cccccccc0102', 'MD-TEST-FEE-101B',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 1,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       '21111111-1111-1111-1111-111111111111',
       'delivered', 'meal_direct_rider',
       100000, 30000, 0, 130000,
       5000, 10000, 10000, now()
     ) $$,
  '23514',
  null::text,
  'resolved shares that do not sum to the delivery fee are rejected'
);

select * from finish();
rollback;
