begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select has_column('public', 'payout_transfers', 'attempt', 'payout_transfers has attempt');
select col_has_check('public', 'vendor_payout_accounts', 'admin_review_status',
  'admin_review_status is check-constrained');
select has_function('public', 'select_payable_settlements',
  array['integer', 'integer', 'integer'],
  'select_payable_settlements(integer, integer, integer) exists');

-- Approve the vendor payout account behind the seeded settlement and back-date the settlement
-- past the hold window so it is eligible.
update public.vendor_payout_accounts
  set admin_review_status = 'approved',
      paystack_recipient_code = 'RCP_seed_vendor'
  where vendor_id = (select vendor_id from public.settlements
                     where id = 'e1111111-1111-1111-1111-111111111111');

update public.settlements
  set created_at = now() - interval '48 hours', status = 'approved'
  where id = 'e1111111-1111-1111-1111-111111111111';

-- Eligible: appears in selection.
select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'approved + held + payable settlement is selected'
);

-- A draft (not yet admin-approved) settlement is NOT auto-paid.
update public.settlements set status = 'draft'
  where id = 'e1111111-1111-1111-1111-111111111111';
select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid not in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'draft settlement is excluded (settlement approval gate preserved)'
);
update public.settlements set status = 'approved'
  where id = 'e1111111-1111-1111-1111-111111111111';

-- A pending transfer excludes it (in-flight guard).
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status, attempt)
values ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a1', 60000, 'pending', 1);

select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid not in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'settlement with a pending transfer is excluded'
);

-- Exhausted attempts exclude it: flip the pending to failed and add failures up to the cap.
update public.payout_transfers set status = 'failed'
  where settlement_id = 'e1111111-1111-1111-1111-111111111111';
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status, attempt)
values
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a2', 60000, 'failed', 2),
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a3', 60000, 'failed', 3);

select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid not in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'settlement at the failed-attempt cap is excluded'
);

select * from finish();

rollback;
