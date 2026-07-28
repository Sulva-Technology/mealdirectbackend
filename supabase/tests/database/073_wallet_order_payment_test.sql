begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

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
  0,
  'no order survives the rejected wallet payment'
);

select is(
  (select coalesce(sum(quantity_reserved), 0)::integer from public.menu_item_inventory
   where menu_item_id = '61111111-1111-1111-1111-111111111111'),
  0,
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

select is(
  (select order_status::text from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'paid',
  'the order lands directly at paid'
);

select is(
  (select payment_method::text from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'wallet',
  'the order records the wallet as its funding source'
);

-- Balance = credit minus the order total; a matching debit entry exists.
select is(
  (select w.balance_kobo from public.wallets w where w.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1000000 - (select total_kobo from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'the wallet was debited by exactly the order total'
);

select * from finish();
rollback;
