begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

-- Regression guard for the slice-D collapse dropping the delivered -> resolve_order_delivery_shares
-- call. Unlike 104 (which calls the resolver directly and so passes even when the transition never
-- invokes it), this drives the real state machine paid -> ready -> out_for_delivery -> delivered
-- through transition_order_status and asserts the three delivery shares actually resolve.
--
-- Timing is deterministic without a controlled clock: service_date = current_date + 1 with slot
-- 5111...113 (delivery_time 12:00, tz Africa/Lagos) puts the slot target instant in the future, so
-- delivered_at = now() (stamped by the delivered transition) is on time and ready_at = now()
-- (stamped by the ready transition) is before target - vendor ready lead. rider_confirmed_ready is
-- set true by the out_for_delivery transition (p_food_was_ready defaults true). For meal_direct_rider
-- on-time + vendor-ready-early + confirmed the split is rider 10000, vendor 5000, platform 15000.
insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values (
  'cccccccc-cccc-cccc-cccc-cccccccc0701', 'MD-TEST-107-A',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 1,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  'paid', 'meal_direct_rider', 100000, 30000, 0, 130000
);

-- Walk the collapsed happy path through the real transition function.
select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0701'::uuid, 'ready');
select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0701'::uuid, 'out_for_delivery');
select public.transition_order_status('cccccccc-cccc-cccc-cccc-cccccccc0701'::uuid, 'delivered');

-- 1-3: the delivered transition resolved the split (would be NULL if the resolver call is missing).
select is(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0701'),
  10000,
  'delivered transition resolves the rider on-time share (10000)'
);
select is(
  (select vendor_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0701'),
  5000,
  'delivered transition resolves the vendor cooking share (5000)'
);
select is(
  (select platform_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0701'),
  15000,
  'delivered transition resolves the platform residual (30000 - 10000 - 5000 = 15000)'
);

-- 4: the timing flag is populated (proves resolution ran, not just that columns kept defaults).
select is(
  (select delivered_on_time from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0701'),
  true,
  'delivered transition resolves delivered_on_time'
);

-- 5: shares are never left NULL after delivery — the core regression assertion.
select isnt(
  (select rider_delivery_share_kobo from public.orders where id = 'cccccccc-cccc-cccc-cccc-cccccccc0701'),
  null,
  'rider delivery share is not NULL after the delivered transition'
);

select * from finish();
rollback;
