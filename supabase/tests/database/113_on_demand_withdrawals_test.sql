begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

-- On-demand withdrawals (20261022000100). Fixtures reuse the seed FK rows tests 101-105 use and
-- a fresh service date (current_date + 5). Everything rolls back.
--
--   order 1301: meal_direct_rider, food 100000, vendor share 5000, rider share 10000, delivered 3h ago
--   order 1302: meal_direct_rider, food 100000, vendor share    0, rider share  5000, delivered 3h ago
--   order 1303: meal_direct_rider, food  50000, delivered just now (inside the 2h hold)
-- Vendor withdrawable now: 100000 + 5000 + 100000 = 205000. Rider: 10000 + 5000 = 15000.

update public.platform_settings set value = to_jsonb(10000) where key = 'withdrawal_min_kobo';
update public.platform_settings set value = to_jsonb(120) where key = 'withdrawal_hold_minutes';

-- Seed orders for this vendor must not leak into the amounts: keep them inside the hold.
update public.orders set delivered_at = now()
where vendor_id = '31111111-1111-1111-1111-111111111111';

insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date,
  delivery_slot_id, location_id, zone_id, order_status, delivery_mode,
  rider_delivery_share_kobo, vendor_delivery_share_kobo,
  food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo, delivered_at
)
select v.id, v.num, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111', current_date + 5,
  '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111', 'delivered', 'meal_direct_rider',
  v.rider_share, v.vendor_share, v.food, 30000, 0, v.food + 30000, v.delivered_at
from (values
  ('cccccccc-cccc-cccc-cccc-cccccccc1301'::uuid, 'MD-TEST-WD-113A', 10000, 5000, 100000, now() - interval '3 hours'),
  ('cccccccc-cccc-cccc-cccc-cccccccc1302'::uuid, 'MD-TEST-WD-113B', 5000, 0, 100000, now() - interval '3 hours'),
  ('cccccccc-cccc-cccc-cccc-cccccccc1303'::uuid, 'MD-TEST-WD-113C', 0, 0, 50000, now())
) as v(id, num, rider_share, vendor_share, food, delivered_at);

select public.add_paid_order_to_batch('cccccccc-cccc-cccc-cccc-cccccccc1301'::uuid);
select public.add_paid_order_to_batch('cccccccc-cccc-cccc-cccc-cccccccc1302'::uuid);

insert into public.delivery_assignments (batch_id, rider_id, status)
select dbo.batch_id, '32111111-1111-1111-1111-111111111111', 'accepted'
from public.delivery_batch_orders dbo
where dbo.order_id = 'cccccccc-cccc-cccc-cccc-cccccccc1301'
on conflict (batch_id) do update set rider_id = excluded.rider_id;

-- 1) No admin-approved payout account yet.
select is(
  (select outcome from public.request_withdrawal(
    '31111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')),
  'no_payout_account',
  'withdrawal needs an approved payout account'
);

update public.vendor_payout_accounts set admin_review_status = 'approved'
where vendor_id = '31111111-1111-1111-1111-111111111111';

-- 2) Withdraws everything past the hold, nothing inside it.
select is(
  (select amount_kobo from public.request_withdrawal(
    '31111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')
   where outcome = 'created'),
  205000,
  'vendor withdrawal = food + vendor share of orders past the hold (205000)'
);

-- 3) The withdrawal is an approved on-demand settlement whose lines match its total.
select results_eq(
  $$ select s.kind, s.status::text, s.payable_kobo, (select sum(l.amount_kobo)::integer
       from public.settlement_lines l where l.settlement_id = s.id)
     from public.settlements s
     where s.vendor_id = '31111111-1111-1111-1111-111111111111' and s.kind = 'on_demand' $$,
  $$ values ('on_demand'::text, 'approved'::text, 205000, 205000) $$,
  'on-demand settlement is approved and its lines sum to its payable'
);

-- 4) Asking again claims nothing twice.
select is(
  (select outcome || ':' || amount_kobo from public.request_withdrawal(
    '31111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')),
  'below_minimum:0',
  'a second request finds nothing left to withdraw'
);

-- 5) A failed transfer cancels the withdrawal and releases its earnings.
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status)
select id, 'test-113-fail', payable_kobo, 'pending'
from public.settlements
where vendor_id = '31111111-1111-1111-1111-111111111111' and kind = 'on_demand';

select public.reconcile_payout_transfer('test-113-fail', 'failed', '{}'::jsonb);

select is(
  (select status::text from public.settlements
   where vendor_id = '31111111-1111-1111-1111-111111111111' and kind = 'on_demand'),
  'cancelled',
  'failed transfer cancels the on-demand withdrawal'
);

select is(
  (select coalesce(sum(amount_kobo), 0)::integer
   from public.vendor_withdrawable_lines('31111111-1111-1111-1111-111111111111', now() - interval '2 hours')),
  205000,
  'cancelled withdrawal returns its earnings to the balance'
);

-- 6) Withdraw again (a second on-demand settlement the same day), then a success marks it paid.
select is(
  (select outcome from public.request_withdrawal(
    '31111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')),
  'created',
  'several on-demand withdrawals may share a day'
);

insert into public.payout_transfers (settlement_id, reference, amount_kobo, status)
select id, 'test-113-ok', payable_kobo, 'pending'
from public.settlements
where vendor_id = '31111111-1111-1111-1111-111111111111' and kind = 'on_demand' and status = 'approved';

select public.reconcile_payout_transfer('test-113-ok', 'success', '{}'::jsonb);

select ok(
  (select s.status = 'paid' and s.paid_at is not null from public.settlements s
   join public.payout_transfers pt on pt.settlement_id = s.id
   where pt.reference = 'test-113-ok'),
  'successful transfer marks the withdrawal paid'
);

-- 7) A refund on an already-withdrawn order comes off the next withdrawal.
insert into public.refunds (order_id, payment_id, amount_kobo, status, reason_code)
select 'cccccccc-cccc-cccc-cccc-cccccccc1301', p.id, 20000, 'succeeded', 'test'
from public.payments p
limit 1;

select is(
  (select coalesce(sum(amount_kobo), 0)::integer
   from public.vendor_withdrawable_lines('31111111-1111-1111-1111-111111111111', now() - interval '2 hours')),
  -20000,
  'refund after withdrawal is owed against future earnings'
);

-- 8) Rider withdraws the resolved rider shares.
insert into public.rider_payout_accounts (
  rider_id, paystack_recipient_code, bank_name, masked_account_number, account_name, admin_review_status
) values (
  '32111111-1111-1111-1111-111111111111', 'RCP_test_113', 'Test Bank', '******1234', 'Test Rider', 'approved'
);

select is(
  (select amount_kobo from public.request_withdrawal(
    null, '32111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3')
   where outcome = 'created'),
  15000,
  'rider withdrawal = resolved rider shares past the hold (10000 + 5000)'
);

-- 9) Daily settlements are blocked from the cutover date.
select throws_ok(
  $$ select public.produce_vendor_daily_settlement(
       '31111111-1111-1111-1111-111111111111'::uuid, current_date + 5,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'::uuid) $$,
  '23514',
  null,
  'daily settlement is refused from the on-demand cutover date'
);

-- 10) Without a cutover date, on-demand is off.
delete from public.platform_settings where key = 'on_demand_payouts_start_date';

select is(
  (select outcome from public.request_withdrawal(
    '31111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')),
  'disabled',
  'removing the cutover date switches withdrawals off'
);

select * from finish();
rollback;
