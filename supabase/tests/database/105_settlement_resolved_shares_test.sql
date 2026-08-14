begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

-- Task 6: settlements and batch earnings read the RESOLVED per-order delivery shares.
--
-- Fixtures reuse the same seed FK rows tests 101-104 use: customer aaaaaaaa-...-aaa1,
-- campus 1111...111, vendor 3111...111, slot 5111...113, location 2211...111, zone 2111...111,
-- and the seed rider 3211...111 (campus 1111...111). Everything is scoped to a fresh
-- service/settlement date (current_date + 5) so no seed order, batch or assignment interferes.
--
-- The two fixture orders are inserted directly at 'delivered' (a valid status literal; no
-- transition runs), which keeps them clear of the pending-payment reservation/cutoff constraints.
-- The resolved delivery-share columns are set directly on the fixtures rather than via
-- resolve_order_delivery_shares; delivered_on_time is left null, so orders_resolved_shares_balance
-- (enforced only when delivered_on_time is non-null) does not require the split to reconstruct the
-- delivery fee. Everything rolls back.
--
--   order 0501: meal_direct_rider, rider share 10000, vendor (cooking) share 5000
--   order 0502: meal_direct_rider, rider share  5000, vendor share 0
-- Expected: rider settlement 15000; rider line for 0501 = 10000; vendor line for 0501 = 5000
-- (present even though the order was rider-delivered); batch earnings 15000.

insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  rider_delivery_share_kobo, vendor_delivery_share_kobo,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo
) values
  (
    'cccccccc-cccc-cccc-cccc-cccccccc0501', 'MD-TEST-FEE-105A',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    '31111111-1111-1111-1111-111111111111',
    current_date + 5,
    '51111111-1111-1111-1111-111111111113',
    '22111111-1111-1111-1111-111111111111',
    '21111111-1111-1111-1111-111111111111',
    'delivered', 'meal_direct_rider',
    10000, 5000,
    100000, 30000, 0, 130000
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccc0502', 'MD-TEST-FEE-105B',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    '31111111-1111-1111-1111-111111111111',
    current_date + 5,
    '51111111-1111-1111-1111-111111111113',
    '22111111-1111-1111-1111-111111111111',
    '21111111-1111-1111-1111-111111111111',
    'delivered', 'meal_direct_rider',
    5000, 0,
    100000, 30000, 0, 130000
  );

-- Build the batch through the real function. Both orders share one logical batch key
-- (campus/vendor/date/slot/zone/mode); the second call recomputes earnings over both orders.
select public.add_paid_order_to_batch('cccccccc-cccc-cccc-cccc-cccccccc0501'::uuid);
select public.add_paid_order_to_batch('cccccccc-cccc-cccc-cccc-cccccccc0502'::uuid);

-- Assign the seed rider to that batch so the rider settlement can find it.
insert into public.delivery_assignments (batch_id, rider_id, status)
select db.id, '32111111-1111-1111-1111-111111111111', 'accepted'
from public.delivery_batches db
where db.campus_id = '11111111-1111-1111-1111-111111111111'
  and db.vendor_id = '31111111-1111-1111-1111-111111111111'
  and db.service_date = current_date + 5
  and db.delivery_slot_id = '51111111-1111-1111-1111-111111111113'
  and db.zone_id = '21111111-1111-1111-1111-111111111111'
  and db.delivery_mode = 'meal_direct_rider';

select public.produce_rider_daily_settlement(
  '32111111-1111-1111-1111-111111111111'::uuid, current_date + 5,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'::uuid);

select public.produce_vendor_daily_settlement(
  '31111111-1111-1111-1111-111111111111'::uuid, current_date + 5,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'::uuid);

-- 1) Rider settlement sums the resolved rider shares: 10000 + 5000 = 15000.
select is(
  (select delivery_earnings_kobo from public.settlements
   where rider_id = '32111111-1111-1111-1111-111111111111' and settlement_date = current_date + 5),
  15000,
  'rider settlement earnings = sum of resolved rider shares (10000 + 5000 = 15000)'
);

-- 2) The rider_delivery line uses the resolved per-order rider share.
select is(
  (select l.amount_kobo
   from public.settlement_lines l
   join public.settlements s on s.id = l.settlement_id
   where s.rider_id = '32111111-1111-1111-1111-111111111111'
     and l.order_id = 'cccccccc-cccc-cccc-cccc-cccccccc0501'
     and l.line_type = 'rider_delivery'),
  10000,
  'rider_delivery line = the order''s resolved rider share (10000)'
);

-- 3) The vendor_delivery line pays the resolved vendor cooking share, present even for a
--    rider-delivered (meal_direct_rider) order.
select is(
  (select l.amount_kobo
   from public.settlement_lines l
   join public.settlements s on s.id = l.settlement_id
   where s.vendor_id = '31111111-1111-1111-1111-111111111111'
     and l.order_id = 'cccccccc-cccc-cccc-cccc-cccccccc0501'
     and l.line_type = 'vendor_delivery'),
  5000,
  'vendor_delivery line = resolved vendor cooking share (5000), paid on a rider-delivered order'
);

-- 4) Batch earnings equal the sum of the batch's resolved rider shares (formula relaxed).
select is(
  (select db.delivery_earnings_kobo
   from public.delivery_batches db
   where db.campus_id = '11111111-1111-1111-1111-111111111111'
     and db.vendor_id = '31111111-1111-1111-1111-111111111111'
     and db.service_date = current_date + 5
     and db.delivery_slot_id = '51111111-1111-1111-1111-111111111113'
     and db.zone_id = '21111111-1111-1111-1111-111111111111'
     and db.delivery_mode = 'meal_direct_rider'),
  15000,
  'batch earnings = sum of the batch orders'' resolved rider shares (15000)'
);

select * from finish();
rollback;
