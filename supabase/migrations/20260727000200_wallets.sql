begin;

create type public.wallet_status as enum ('active', 'frozen');

create type public.wallet_entry_type as enum (
  'topup',          -- inbound bank transfer or checkout-funded credit
  'order_payment',  -- debit that pays for an order
  'order_refund',   -- credit returning an order total
  'adjustment',     -- admin-created credit or debit, always with a reason
  'reversal'        -- reverses a prior entry
);

create type public.dva_status as enum ('pending', 'active', 'failed', 'deactivated');

create type public.order_payment_method as enum ('wallet', 'paystack');

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  balance_kobo integer not null default 0,
  currency char(3) not null default 'NGN',
  status public.wallet_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_balance_non_negative check (balance_kobo >= 0),
  constraint wallets_currency_ngn check (currency = 'NGN')
);

comment on table public.wallets is 'Per-customer spendable balance. balance_kobo is a cached projection of wallet_ledger_entries, which is the source of truth.';

create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

-- Append-only money history. Every balance change writes exactly one row here.
create table public.wallet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  entry_type public.wallet_entry_type not null,
  amount_kobo integer not null,
  balance_after_kobo integer not null,
  order_id uuid references public.orders(id) on delete set null,
  provider_reference text,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_entries_amount_non_zero check (amount_kobo <> 0),
  constraint wallet_ledger_entries_balance_non_negative check (balance_after_kobo >= 0),
  constraint wallet_ledger_entries_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.wallet_ledger_entries is 'Append-only signed wallet movements. Credits are positive, debits negative; balance_after_kobo snapshots the wallet balance immediately after the entry.';
comment on column public.wallet_ledger_entries.amount_kobo is 'Signed: credits positive, debits negative.';

create index wallet_ledger_entries_wallet_idx
  on public.wallet_ledger_entries (wallet_id, created_at desc, id desc);
create index wallet_ledger_entries_order_idx
  on public.wallet_ledger_entries (order_id);

-- Webhook replay guard: one topup per Paystack reference, ever.
create unique index wallet_ledger_entries_topup_reference_idx
  on public.wallet_ledger_entries (provider_reference)
  where entry_type = 'topup';

create trigger wallet_ledger_entries_prevent_update
before update or delete on public.wallet_ledger_entries
for each row execute function public.prevent_update_delete();

create table public.wallet_dedicated_accounts (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null unique references public.wallets(id) on delete restrict,
  paystack_customer_code text not null,
  account_number text unique not null,
  account_name text not null,
  bank_name text not null,
  bank_slug text not null,
  status public.dva_status not null default 'pending',
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_dedicated_accounts_payload_object check (jsonb_typeof(provider_payload) = 'object')
);

comment on table public.wallet_dedicated_accounts is 'Paystack dedicated virtual account (DVA) bound to a wallet. account_number is what the customer transfers to.';

create trigger wallet_dedicated_accounts_set_updated_at
before update on public.wallet_dedicated_accounts
for each row execute function public.set_updated_at();

-- Which source paid an order. Existing rows are all Paystack checkout.
alter table public.orders
  add column if not exists payment_method public.order_payment_method not null default 'paystack';

comment on column public.orders.payment_method is 'Funding source for this order: wallet balance or a Paystack checkout. Every order is paid from exactly one source.';

create index orders_payment_method_idx on public.orders (payment_method, created_at desc);

-- Provision (or find) the wallet for a customer. Emits wallet.dva_requested exactly once,
-- on first creation; the outbox worker turns that into a Paystack customer + DVA.
create or replace function public.ensure_customer_wallet(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
begin
  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  if v_wallet_id is not null then
    return v_wallet_id;
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing
  returning id into v_wallet_id;

  -- Lost the race: another session created it, and it already queued its own event.
  if v_wallet_id is null then
    select id into v_wallet_id from public.wallets where user_id = p_user_id;
    return v_wallet_id;
  end if;

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'wallet.dva_requested',
    'wallet',
    v_wallet_id,
    jsonb_build_object('wallet_id', v_wallet_id, 'user_id', p_user_id)
  );

  return v_wallet_id;
end;
$$;

comment on function public.ensure_customer_wallet(uuid) is 'Idempotently provisions a customer wallet and queues wallet.dva_requested once on first creation.';

-- Single writer for every balance change. Locks the wallet, appends the signed entry,
-- and updates the cached balance. Raises 23514 when the debit would go negative.
create or replace function public.append_wallet_ledger_entry(
  p_wallet_id uuid,
  p_entry_type public.wallet_entry_type,
  p_amount_kobo integer,
  p_order_id uuid default null,
  p_provider_reference text default null,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_entry_id uuid;
begin
  if p_amount_kobo = 0 then
    raise exception 'wallet ledger amount must be non-zero' using errcode = '23514';
  end if;

  select balance_kobo into v_balance
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'wallet % not found', p_wallet_id using errcode = 'P0002';
  end if;

  v_balance := v_balance + p_amount_kobo;
  if v_balance < 0 then
    raise exception 'wallet balance cannot go negative' using errcode = '23514';
  end if;

  insert into public.wallet_ledger_entries (
    wallet_id, entry_type, amount_kobo, balance_after_kobo,
    order_id, provider_reference, actor_user_id, reason, metadata
  )
  values (
    p_wallet_id, p_entry_type, p_amount_kobo, v_balance,
    p_order_id, p_provider_reference, p_actor_user_id, p_reason,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_entry_id;

  update public.wallets
  set balance_kobo = v_balance
  where id = p_wallet_id;

  return v_entry_id;
end;
$$;

comment on function public.append_wallet_ledger_entry(uuid, public.wallet_entry_type, integer, uuid, text, uuid, text, jsonb) is 'The only writer of wallet balances: locks the wallet, appends a signed append-only ledger entry, and refreshes the cached balance.';

-- Credit an inbound transfer. Resolves the wallet from the DVA account number when one is
-- given, else from the user id (checkout-funded top-up while DVA is not yet enabled).
-- Returns the new ledger entry id, or null when the provider reference was already credited.
create or replace function public.credit_wallet_topup(
  p_provider_reference text,
  p_account_number text,
  p_user_id uuid,
  p_amount_kobo integer,
  p_sender_name text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_entry_id uuid;
  v_balance integer;
  v_cap integer;
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'top-up amount must be positive' using errcode = '23514';
  end if;

  if p_account_number is not null then
    select wallet_id into v_wallet_id
    from public.wallet_dedicated_accounts
    where account_number = p_account_number;
  end if;

  if v_wallet_id is null and p_user_id is not null then
    v_wallet_id := public.ensure_customer_wallet(p_user_id);
  end if;

  if v_wallet_id is null then
    raise exception 'no wallet matches account number % or user %', p_account_number, p_user_id using errcode = 'P0002';
  end if;

  -- Replay guard. The partial unique index is the hard constraint; this read keeps the
  -- common duplicate path from aborting the caller's transaction.
  if exists (
    select 1 from public.wallet_ledger_entries
    where entry_type = 'topup' and provider_reference = p_provider_reference
  ) then
    return null;
  end if;

  begin
    v_entry_id := public.append_wallet_ledger_entry(
      v_wallet_id,
      'topup',
      p_amount_kobo,
      null,
      p_provider_reference,
      null,
      'inbound transfer credited',
      jsonb_build_object(
        'sender_name', p_sender_name,
        'account_number', p_account_number,
        'provider_payload', coalesce(p_payload, '{}'::jsonb)
      )
    );
  exception when unique_violation then
    -- Concurrent delivery of the same webhook won the race.
    return null;
  end;

  -- The cap is advisory: money already arrived, so credit it and flag for review.
  select balance_kobo into v_balance from public.wallets where id = v_wallet_id;
  v_cap := public.platform_setting_int('wallet_max_balance_kobo', 5000000);

  if v_balance > v_cap then
    perform public.upsert_payment_reconciliation_issue(
      'wallet_balance_cap_exceeded:' || v_wallet_id::text,
      'wallet_balance_cap_exceeded'::public.payment_reconciliation_issue_type,
      'warning'::public.payment_reconciliation_severity,
      null,
      null,
      p_provider_reference,
      jsonb_build_object('walletId', v_wallet_id, 'balanceKobo', v_balance, 'capKobo', v_cap)
    );
  end if;

  return v_entry_id;
end;
$$;

comment on function public.credit_wallet_topup(text, text, uuid, integer, text, jsonb) is 'Credits an inbound top-up idempotently on the provider reference, resolving the wallet by DVA account number or user id, and flags balances above the advisory cap.';

commit;
