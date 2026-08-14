begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

-- The seed already gives customer aaa1 several orders, and the item may carry seeded
-- reservations. Snapshot both baselines so the rollback assertions compare against
-- "no change" rather than absolute zero and stay robust as the seed grows.
create temp table _wallet_baseline on commit drop as
select
  (select count(*)::integer
     from public.orders
     where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') as order_count,
  (select coalesce(sum(quantity_reserved), 0)::integer
     from public.menu_item_inventory
     where menu_item_id = '61111111-1111-1111-1111-111111111111') as reserved;

-- Empty wallet cannot pay.
select throws_ok(
  $$ select public.create_paid_order_from_wallet(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
       'pgtap-wallet-broke',
       'hash-wallet-broke'
     ) $$,
  'MDW01',
  null,
  'an empty wallet is rejected with the insufficient-balance SQLSTATE'
);

select is(
  (select count(*)::integer from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  (select order_count from _wallet_baseline),
  'no new order survives the rejected wallet payment'
);

select is(
  (select coalesce(sum(quantity_reserved), 0)::integer from public.menu_item_inventory
   where menu_item_id = '61111111-1111-1111-1111-111111111111'),
  (select reserved from _wallet_baseline),
  'the inventory reservation was rolled back with the transaction'
);

-- Fund the wallet generously, then pay.
select public.credit_wallet_topup(
  'PSTK-FUND-1', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1000000, 'ADA LOVELACE', '{}'::jsonb
);

select lives_ok(
  $$ select public.create_paid_order_from_wallet(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
       'pgtap-wallet-pays',
       'hash-wallet-pays'
     ) $$,
  'a funded wallet pays for the order'
);

-- Scope the paid-order assertions to exactly the order this call created, resolved via
-- its idempotency-key resource, so seeded orders for the same customer never interfere.
create temp table _paid_order on commit drop as
select o.*
from public.orders o
join public.idempotency_keys k on k.resource_id = o.id
where k.actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  and k.operation = 'create_order'
  and k.idempotency_key = 'pgtap-wallet-pays';

select is(
  (select order_status::text from _paid_order),
  'paid',
  'the order lands directly at paid'
);

select is(
  (select payment_method::text from _paid_order),
  'wallet',
  'the order records the wallet as its funding source'
);

-- Balance = credit minus the order total; a matching debit entry exists.
select is(
  (select w.balance_kobo from public.wallets w where w.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1000000 - (select total_kobo from _paid_order),
  'the wallet was debited by exactly the order total'
);

select * from finish();
rollback;
