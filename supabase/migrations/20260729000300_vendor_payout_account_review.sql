begin;

-- Admin review + failure diagnostics for vendor payout accounts, mirroring the columns
-- rider_payout_accounts gained in 20260703000500. Vendors cannot change admin_review_status
-- themselves — the vendor payout-account update path whitelists mutable columns and does not
-- include it. Auto-payouts only select accounts with admin_review_status = 'approved'.
alter table public.vendor_payout_accounts
  add column if not exists admin_review_status text not null default 'pending'
    check (admin_review_status in ('pending', 'approved', 'rejected')),
  add column if not exists failure_reason text;

comment on column public.vendor_payout_accounts.admin_review_status is 'Admin review state for the payout account; vendors cannot change this.';
comment on column public.vendor_payout_accounts.failure_reason is 'Recorded reason when recipient provisioning or a payout attempt fails.';

commit;
