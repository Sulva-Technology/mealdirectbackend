begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

select has_column('public', 'vendor_payout_accounts', 'admin_review_status',
  'vendor_payout_accounts has admin_review_status');
select has_column('public', 'vendor_payout_accounts', 'failure_reason',
  'vendor_payout_accounts has failure_reason');

-- Default is 'pending'.
select col_default_is('public', 'vendor_payout_accounts', 'admin_review_status', 'pending'::text,
  'admin_review_status defaults to pending');

-- Check constraint rejects an unknown status.
select throws_ok(
  $$ insert into public.vendor_payout_accounts
       (vendor_id, bank_name, masked_account_number, account_name, admin_review_status)
     values
       ((select id from public.vendors limit 1), 'Kuda', '****1234', 'Ada V', 'bogus') $$,
  '23514',
  null,
  'admin_review_status rejects values outside pending/approved/rejected'
);

select * from finish();

rollback;
