begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

-- Provisioning is idempotent and returns the same wallet both times.
select is(
  public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'ensure_customer_wallet is idempotent'
);

select is(
  (select count(*)::integer from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1,
  'exactly one wallet row per customer'
);

select is(
  (select count(*)::integer from public.outbox_events
   where event_type = 'wallet.dva_requested'
     and aggregate_id = public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')),
  1,
  'DVA provisioning is requested exactly once'
);

-- A top-up credits the balance.
select ok(
  public.credit_wallet_topup('PSTK-TOPUP-1', (select account_number from public.wallet_dedicated_accounts limit 0), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 200000, 'ADA LOVELACE', '{}'::jsonb) is not null,
  'first top-up is credited'
);

select is(
  (select balance_kobo from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  200000,
  'balance reflects the credit'
);

-- Replay of the same provider reference is a no-op.
select is(
  public.credit_wallet_topup('PSTK-TOPUP-1', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 200000, 'ADA LOVELACE', '{}'::jsonb),
  null,
  'replayed provider reference credits nothing'
);

select is(
  (select balance_kobo from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  200000,
  'balance is unchanged after replay'
);

-- The ledger is append-only.
select throws_ok(
  $$ update public.wallet_ledger_entries set amount_kobo = 1 $$,
  '23000',
  null,
  'ledger entries cannot be updated'
);

select throws_ok(
  $$ delete from public.wallet_ledger_entries $$,
  '23000',
  null,
  'ledger entries cannot be deleted'
);

select * from finish();
rollback;
