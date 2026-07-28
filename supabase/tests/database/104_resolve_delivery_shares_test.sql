begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

-- Unit tests for resolve_order_delivery_shares, driven with fully controlled inputs so timing is
-- deterministic and never depends on the wall clock. Fixtures reuse the same seed FK rows tests
-- 101-103 use: customer aaaaaaaa-...-aaa1, campus 1111... (timezone Africa/Lagos), vendor
-- 3111...111, slot 5111...113 (delivery_time 12:00), location 2211...111, zone 2111...111.
--
-- The slot target instant is (service_date + slot.delivery_time) at time zone campus.timezone.
-- With service_date = current_date + 5, delivery_time = 12:00, tz = Africa/Lagos, that fixed
-- instant is T := ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos'.
-- Each fixture sets ready_at / delivered_at relative to T:
--   on-time delivered  = T - 1 min   (<= T)
--   late delivered     = T + 1 min   (>  T)
--   ready early (ok)   = T - 20 min  (<= T - vendor_ready_lead_minutes(10))
--   ready late (miss)  = T - 1 min   (>  T - 10 min)
--
-- Fixtures are inserted directly at 'delivered' (a valid status literal; no transition runs),
-- which keeps them clear of the pending-payment reservation/cutoff constraints. The resolver's
-- UPDATE of the split columns then exercises the RELAXED protect_order_financial_history trigger
-- (this migration dropped the two share-column checks), so it must pass at a non-pending status.
-- Everything rolls back.

-- Fixture 1: rider mode, delivered on time, vendor ready early + rider_confirmed_ready = true.
-- Expect rider 10000, vendor 5000, platform 30000 - 10000 - 5000 = 15000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  point_delivery, rider_confirmed_ready, ready_at, delivered_at,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0401', 'MD-TEST-FEE-104A',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 5,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'delivered', 'meal_direct_rider',
  false, true,
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '20 minutes',
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '1 minute',
  100000, 30000, 0, 130000
);

select resolve_order_delivery_shares('cccccccc-cccc-cccc-cccc-cccccccc0401'::uuid);

select is(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0401'),
  10000,
  'rider mode on-time delivery pays the rider the on-time share (10000)'
);
select is(
  (select vendor_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0401'),
  5000,
  'rider mode with vendor ready early + rider-confirmed pays the vendor cooking share (5000)'
);
select is(
  (select platform_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0401'),
  15000,
  'platform residual is 30000 - 10000 - 5000 = 15000'
);

-- Fixture 2: rider mode, delivered late, vendor NOT ready early (ready late) + not confirmed.
-- Expect rider 5000 (late), vendor 0, platform 30000 - 5000 - 0 = 25000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  point_delivery, rider_confirmed_ready, ready_at, delivered_at,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0402', 'MD-TEST-FEE-104B',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 5,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'delivered', 'meal_direct_rider',
  false, false,
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '1 minute',
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' + interval '1 minute',
  100000, 30000, 0, 130000
);

select resolve_order_delivery_shares('cccccccc-cccc-cccc-cccc-cccccccc0402'::uuid);

select is(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0402'),
  5000,
  'rider mode late delivery pays the rider only the late share (5000)'
);
select is(
  (select vendor_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0402'),
  0,
  'rider mode with vendor not ready early pays no cooking share (0)'
);
select is(
  (select platform_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0402'),
  25000,
  'platform residual absorbs the forfeits: 30000 - 5000 - 0 = 25000'
);

-- Fixture 3: rider mode, point_delivery = true, delivered on time, vendor ready early + confirmed,
-- delivery fee 40000 (base 30000 + point surcharge 10000).
-- Expect rider on-time(10000) + point(5000) = 15000; vendor 5000; platform 40000 - 15000 - 5000 = 20000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  point_delivery, rider_confirmed_ready, ready_at, delivered_at,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0403', 'MD-TEST-FEE-104C',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 5,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'delivered', 'meal_direct_rider',
  true, true,
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '20 minutes',
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '1 minute',
  100000, 40000, 0, 140000
);

select resolve_order_delivery_shares('cccccccc-cccc-cccc-cccc-cccccccc0403'::uuid);

select is(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0403'),
  15000,
  'point delivery adds the point share to the rider on-time share: 10000 + 5000 = 15000'
);
select is(
  (select platform_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0403'),
  20000,
  'point-delivery platform residual is 40000 - 15000 - 5000 = 20000'
);

-- Fixture 4: vendor_delivery mode, ready early + delivered on time, fee 30000.
-- Vendor gets ready(5000) + delivery on-time(10000) + point(0) = 15000; rider 0; platform 15000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  point_delivery, rider_confirmed_ready, ready_at, delivered_at,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0404', 'MD-TEST-FEE-104D',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 5,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'delivered', 'vendor_delivery',
  false, null,
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '20 minutes',
  ((current_date + 5)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos' - interval '1 minute',
  100000, 30000, 0, 130000
);

select resolve_order_delivery_shares('cccccccc-cccc-cccc-cccc-cccccccc0404'::uuid);

select is(
  (select vendor_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0404'),
  15000,
  'vendor_delivery mode: vendor earns cooking(5000) + on-time delivery(10000) = 15000'
);
select is(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0404'),
  0,
  'vendor_delivery mode pays the rider nothing (0)'
);

-- 10: delivered_on_time is set after resolution. This proves the resolver UPDATE passed the
-- relaxed protect_order_financial_history trigger AND satisfied orders_resolved_shares_balance
-- (which is enforced exactly when delivered_on_time is non-null).
select is(
  (select delivered_on_time from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0401'),
  true,
  'resolution set delivered_on_time (the relaxed trigger let the split update through)'
);

select * from finish();
rollback;
