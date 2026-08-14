begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select ok(
  'wallet' = any (enum_range(null::public.payment_provider)::text[]),
  'payment_provider gained the wallet value'
);

select ok(
  'wallet_balance_drift' = any (enum_range(null::public.payment_reconciliation_issue_type)::text[]),
  'reconciliation issue types gained wallet_balance_drift'
);

select ok(
  'wallet_balance_cap_exceeded' = any (enum_range(null::public.payment_reconciliation_issue_type)::text[]),
  'reconciliation issue types gained wallet_balance_cap_exceeded'
);

select * from finish();
rollback;
