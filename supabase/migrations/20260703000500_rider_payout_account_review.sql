begin;

-- Admin review + failure diagnostics for rider payout accounts, mirroring the fields the
-- rider app and admin payout review expect. Verification (verified_at) is set when a
-- Paystack transfer recipient is provisioned from the full account number at capture time.
alter table public.rider_payout_accounts
  add column if not exists admin_review_status text not null default 'pending'
    check (admin_review_status in ('pending', 'approved', 'rejected')),
  add column if not exists failure_reason text;

comment on column public.rider_payout_accounts.admin_review_status is 'Admin review state for the payout account; riders cannot change this.';
comment on column public.rider_payout_accounts.failure_reason is 'Recorded reason when recipient provisioning or a payout attempt fails.';

commit;
