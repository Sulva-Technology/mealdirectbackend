begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

-- Fixtures reuse the seed FK rows (customer/campus/vendor/slot/location/zone from MD-SEED-PENDING).
-- Six independent orders so each transition/insert assertion runs on its own row.
-- total_kobo = food(100000) + delivery(30000) - discount(0) = 130000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0601', 'MD-TEST-106-A',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'paid', 'meal_direct_rider', 100000, 30000, 0, 130000),
  ('cccccccc-cccc-cccc-cccc-cccccccc0602', 'MD-TEST-106-B',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'paid', 'meal_direct_rider', 100000, 30000, 0, 130000),
  ('cccccccc-cccc-cccc-cccc-cccccccc0603', 'MD-TEST-106-C',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'delivered', 'meal_direct_rider', 100000, 30000, 0, 130000),
  ('cccccccc-cccc-cccc-cccc-cccccccc0604', 'MD-TEST-106-D',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'delivered', 'meal_direct_rider', 100000, 30000, 0, 130000),
  ('cccccccc-cccc-cccc-cccc-cccccccc0605', 'MD-TEST-106-E',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'delivered', 'meal_direct_rider', 100000, 30000, 0, 130000),
  ('cccccccc-cccc-cccc-cccc-cccccccc0606', 'MD-TEST-106-F',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', current_date + 1,
   '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'paid', 'meal_direct_rider', 100000, 30000, 0, 130000);

-- 1: the collapsed vendor path paid -> ready is legal.
select lives_ok(
  $$ select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0601'::uuid, 'ready') $$,
  'paid -> ready is allowed (single vendor transition)'
);

-- 2: the removed intermediate transition paid -> accepted is rejected (23514).
select throws_ok(
  $$ select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0602'::uuid, 'accepted') $$,
  '23514', null,
  'paid -> accepted is rejected'
);

-- 3: delivered is terminal for the happy path: delivered -> confirmed is rejected (23514).
select throws_ok(
  $$ select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0603'::uuid, 'confirmed') $$,
  '23514', null,
  'delivered -> confirmed is rejected'
);

-- 4: delivered -> administratively_completed (admin/ops terminal) is still allowed.
select lives_ok(
  $$ select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0604'::uuid, 'administratively_completed') $$,
  'delivered -> administratively_completed is allowed'
);

-- 5: a delivered order is review-eligible (enforce_review_eligibility passes for the owning customer).
select lives_ok(
  $$ insert into public.reviews (order_id, reviewer_id, food_rating)
     values ('cccccccc-cccc-cccc-cccc-cccccccc0605'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid, 5) $$,
  'a delivered order can be reviewed by its customer'
);

-- 6: a paid (not yet delivered) order is not review-eligible (trigger raises 23514).
select throws_ok(
  $$ insert into public.reviews (order_id, reviewer_id, food_rating)
     values ('cccccccc-cccc-cccc-cccc-cccccccc0606'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid, 5) $$,
  '23514', null,
  'a paid order cannot be reviewed'
);

select * from finish();
rollback;
