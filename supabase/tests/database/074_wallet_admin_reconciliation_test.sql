begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

-- Admin adjustment requires a reason.
select throws_ok(
  $$ select public.admin_adjust_wallet(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       100000,
       '   ',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
     ) $$,
  '23514',
  null,
  'a blank reason is rejected'
);

select lives_ok(
  $$ select public.admin_adjust_wallet(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       100000,
       'goodwill credit',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
     ) $$,
  'an adjustment with a reason is accepted'
);

select is(
  (select balance_kobo from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  100000,
  'the adjustment moved the balance'
);

-- A frozen wallet still receives credits.
select lives_ok(
  $$ select public.set_wallet_status(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       'frozen'::public.wallet_status
     ) $$,
  'a wallet can be frozen'
);

select lives_ok(
  $$ select public.credit_wallet_topup(
       'PSTK-FROZEN-1', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 50000, 'ADA LOVELACE', '{}'::jsonb
     ) $$,
  'a frozen wallet still accepts credits'
);

-- Drift detection files a critical issue when the cache disagrees with the ledger.
select is(
  public.detect_wallet_balance_drift(),
  0,
  'a consistent wallet produces no drift issues'
);

select * from finish();
rollback;
