begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

select has_table('public', 'payout_transfers', 'payout_transfers table exists');
select has_column('public', 'riders', 'paystack_recipient_code', 'riders has paystack_recipient_code');
select has_function(
  'public',
  'reconcile_payout_transfer',
  array['text', 'text', 'jsonb'],
  'reconcile_payout_transfer(text, text, jsonb) exists'
);

-- Seed a pending payout transfer against an existing approved settlement, then reconcile it.
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status)
values ('e1111111-1111-1111-1111-111111111111', 'SETTLE-SEED-VENDOR-XFER', 60000, 'pending');

select public.reconcile_payout_transfer(
  'SETTLE-SEED-VENDOR-XFER',
  'success',
  '{"event":"transfer.success"}'::jsonb
);

select is(
  (select status from public.payout_transfers where reference = 'SETTLE-SEED-VENDOR-XFER'),
  'success',
  'transfer status becomes success after reconciliation'
);

select is(
  (select status::text from public.settlements where id = 'e1111111-1111-1111-1111-111111111111'),
  'paid',
  'settlement becomes paid when its transfer succeeds'
);

select * from finish();

rollback;
