begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

-- Fixture A: an order inserted at 'preparing' (so preparing -> ready is a legal transition and
-- the pending-payment insert-cutoff trigger does not fire). Reuses seed FK rows
-- (customer/campus/vendor/slot/location/zone from MD-SEED-PENDING), same set Task 2's test used.
-- total_kobo = food(100000) + delivery(30000) + service_fee(0) + surcharge(0) - discount(0) = 130000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0201', 'MD-TEST-FEE-102A',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 1,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'preparing', 'meal_direct_rider',
  100000, 30000, 0, 130000
);

-- 1: transitioning to 'ready' stamps ready_at.
select transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0201'::uuid, 'ready');
select isnt(
  (select ready_at from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0201'),
  null,
  'transition to ready stamps ready_at'
);

-- 2: transitioning ready -> out_for_delivery with p_food_was_ready => true records the confirmation.
select transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0201'::uuid, 'out_for_delivery', p_food_was_ready => true);
select is(
  (select rider_confirmed_ready from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0201'),
  true,
  'transition to out_for_delivery with food ready records rider_confirmed_ready = true'
);

-- Fixture B: an order inserted at 'ready' (a legal, non-pending source status), driven
-- ready -> out_for_delivery with p_food_was_ready => false. Proves the flag is captured from the
-- argument, not hardcoded to true.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0202', 'MD-TEST-FEE-102B',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 1,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'ready', 'meal_direct_rider',
  100000, 30000, 0, 130000
);

-- 3: p_food_was_ready => false is captured (not hardcoded).
select transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0202'::uuid, 'out_for_delivery', p_food_was_ready => false);
select is(
  (select rider_confirmed_ready from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0202'),
  false,
  'transition to out_for_delivery with food not ready records rider_confirmed_ready = false'
);

select * from finish();
rollback;
