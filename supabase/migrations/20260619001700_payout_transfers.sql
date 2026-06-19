begin;

alter table public.riders
  add column if not exists paystack_recipient_code text;

comment on column public.riders.paystack_recipient_code is 'Paystack transfer recipient code provisioned for rider payouts; null until first payout.';

create table public.payout_transfers (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete restrict,
  provider text not null default 'paystack',
  provider_transfer_code text,
  reference text not null,
  amount_kobo integer not null check (amount_kobo > 0),
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'reversed')),
  initiated_by uuid references public.profiles(id) on delete set null,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_transfers_reference_unique unique (reference),
  constraint payout_transfers_settlement_unique unique (settlement_id)
);

comment on table public.payout_transfers is 'One payout transfer per settlement initiated via the provider, reconciled by the transfer webhook.';
comment on column public.payout_transfers.reference is 'Stable client-generated transfer reference (typically the settlement id); unique per transfer.';
comment on column public.payout_transfers.status is 'Lifecycle: pending until the provider webhook reports success, failed, or reversed.';
comment on column public.payout_transfers.provider_transfer_code is 'Provider transfer code returned at initiation, used to correlate webhook events.';

create index payout_transfers_status_idx on public.payout_transfers (status);

create trigger payout_transfers_set_updated_at
before update on public.payout_transfers
for each row execute function public.set_updated_at();

grant select on public.payout_transfers to authenticated;

alter table public.payout_transfers enable row level security;

-- Reconcile a transfer by reference (called by the webhook); marks the settlement paid on success.
-- SECURITY DEFINER with a fixed search_path so the webhook path can update without elevated client rights.
create or replace function public.reconcile_payout_transfer(
  p_reference text,
  p_status text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
begin
  update public.payout_transfers
  set status = p_status,
      provider_payload = p_payload
  where reference = p_reference
  returning settlement_id into v_settlement_id;

  if v_settlement_id is not null and p_status = 'success' then
    update public.settlements set status = 'paid' where id = v_settlement_id;
  end if;
end;
$$;

comment on function public.reconcile_payout_transfer(text, text, jsonb) is 'Updates a payout transfer status by reference from the provider webhook and marks the linked settlement paid when the transfer succeeds.';

commit;
