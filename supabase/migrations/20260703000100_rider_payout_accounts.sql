begin;

create table public.rider_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  paystack_recipient_code text,
  bank_name text not null,
  bank_code text,
  masked_account_number text not null,
  account_name text not null,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rider_payout_accounts_masked_only check (masked_account_number ~ '^\*{4,}[0-9]{2,4}$')
);

comment on table public.rider_payout_accounts is 'Rider payout destination snapshots. Full account numbers are never stored.';
comment on column public.rider_payout_accounts.paystack_recipient_code is 'Paystack transfer recipient code provisioned from the full account number at capture time.';

create index rider_payout_accounts_rider_active_idx on public.rider_payout_accounts (rider_id, active);
create trigger rider_payout_accounts_set_updated_at
before update on public.rider_payout_accounts
for each row execute function public.set_updated_at();

-- Sensitive bank snapshots: mirror vendor_payout_accounts and keep the table private.
-- RLS is enabled and no anon/authenticated grants or policies are added, so only the
-- privileged application role (which bypasses RLS) can read or write these rows.
alter table public.rider_payout_accounts enable row level security;

commit;
