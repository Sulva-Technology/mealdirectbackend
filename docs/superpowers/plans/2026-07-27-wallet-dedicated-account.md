# Wallet + Paystack Dedicated Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every customer a wallet with a Paystack dedicated virtual account (DVA), fundable by bank transfer, spendable on orders in a single atomic transaction, refundable to balance, with admin oversight and nightly reconciliation.

**Architecture:** A new `wallets` NestJS module owns customer + admin wallet HTTP surface. Money movement lives in Postgres: an append-only `wallet_ledger_entries` table is the source of truth, `wallets.balance_kobo` is a cached projection maintained by `security definer` plpgsql functions, and a new `create_paid_order_from_wallet` RPC does inventory reservation, wallet debit, order insert-at-`paid` and inventory sell-through in one transaction under row locks. Inbound top-ups arrive as Paystack `charge.success` webhooks whose `authorization.channel = 'dedicated_nuban'`, routed by a new domain event type _before_ the existing order-reference lookup. DVA provisioning is asynchronous through the existing outbox worker and gated by `WALLET_DVA_ENABLED`.

**Tech Stack:** NestJS 11 (Fastify), Kysely raw `sql` tags over `pg`, Postgres/Supabase migrations in `supabase/migrations`, pgTAP for database tests, Vitest for unit/integration, class-validator DTOs, `@nestjs/swagger` for OpenAPI.

---

## Deviations from the spec (read before starting)

These are five places where `docs/superpowers/specs/2026-07-25-wallet-dedicated-account-design.md` does not match the code as it exists today. Each is resolved here; do not silently "fix" them back.

1. **`payments:manage` does not exist.** `src/domain/admin-permissions.ts` has `payments:verify`, `refunds:manage`, `settlements:manage`, `reconciliation:manage`, `admin:manage` — there is no `payments:manage`. This plan adds a new granular permission **`wallets:manage`** (naming matches `refunds:manage`) granted to `super_admin`, `campus_admin` and `finance_admin`. Admin settings routes use the existing `admin:manage`, as the spec says.

2. **The wallet order must also sell through inventory and join a batch.** The spec's `create_paid_order_from_wallet` step list stops at "insert the order at `paid`". The existing paid path (`mark_verified_payment_successful`, `supabase/migrations/20260707000110_recover_expired_order_on_verified_payment.sql`) additionally moves `quantity_reserved → quantity_sold` and calls `public.add_paid_order_to_batch(order_id)`. Skipping either would leave wallet orders permanently reserved and never dispatched. The RPC in Task 4 does both.

3. **Outbox event is `payment.successful`, not `order.paid`.** No handler or notification template knows `order.paid`; `supabase/migrations/20260702000100_role_order_notifications.sql:41` fans out on `payment.successful`, and `NOTIFICATION_EVENT_PREFIXES` in `src/worker/handler-registry.ts` lists `'payment.'`. A wallet order emits `payment.successful` so customer + vendor notifications fire exactly as they do for card orders.

4. **Two new reconciliation issue types, not one.** The spec adds `wallet_balance_drift` for nightly drift. The "credit over the cap raises an admin flag" requirement has no home, so this plan also adds `wallet_balance_cap_exceeded` (severity `warning`).

5. **Cursor helpers.** `decodeListCursor` / `toList` are **private** methods on `AdminRepository`. The wallets repository uses the shared `encodeCursor` / `decodeCursor` from `src/common/api/pagination.ts` that those private methods are themselves built on, emitting the identical `{ ts, id }` base64url payload. Wire format is unchanged.

## Sequencing constraint: enum values

Postgres forbids _using_ an enum value added by `alter type ... add value` inside the same transaction that added it. Every migration file in this repo is wrapped in its own `begin; ... commit;`. Therefore **Task 2 does nothing but add enum values**, and no later statement in that file references them. Tasks 3+ live in separate files and may use them freely.

## File structure

**Migrations (new, applied in filename order):**

| File                                                                   | Responsibility                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260727000100_platform_settings.sql`             | Generic `platform_settings` key/value table, seeds, `platform_setting_int()` reader                                                                           |
| `supabase/migrations/20260727000150_wallet_enum_values.sql`            | `alter type` only: `payment_provider += 'wallet'`, `payment_reconciliation_issue_type += 'wallet_balance_drift','wallet_balance_cap_exceeded'`                |
| `supabase/migrations/20260727000200_wallets.sql`                       | Wallet enums, three tables, append-only trigger, `orders.payment_method`, `ensure_customer_wallet()`, `append_wallet_ledger_entry()`, `credit_wallet_topup()` |
| `supabase/migrations/20260727000300_create_paid_order_from_wallet.sql` | The atomic checkout RPC                                                                                                                                       |
| `supabase/migrations/20260727000400_wallet_reconciliation.sql`         | `detect_wallet_balance_drift()`, `admin_adjust_wallet()`, `set_wallet_status()`, `refund_order_to_wallet()`                                                   |

**TypeScript (new):**

| File                                                  | Responsibility                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/domain/wallet.ts`                                | Pure wallet types + SQLSTATE constants shared by repo/service/error mapping |
| `src/modules/wallets/wallets.types.ts`                | Repository/service contracts and record shapes                              |
| `src/modules/wallets/wallets.repository.ts`           | All wallet SQL (customer + admin)                                           |
| `src/modules/wallets/wallets.service.ts`              | Customer wallet use-cases, DVA gating                                       |
| `src/modules/wallets/admin-wallets.service.ts`        | Admin oversight use-cases + audit                                           |
| `src/modules/wallets/platform-settings.repository.ts` | `platform_settings` read/write                                              |
| `src/modules/wallets/wallets.controller.ts`           | `GET /wallet`, `GET /wallet/ledger`, `POST /wallet/dedicated-account`       |
| `src/modules/wallets/admin-wallets.controller.ts`     | `/admin/wallets*`                                                           |
| `src/modules/wallets/admin-settings.controller.ts`    | `/admin/settings`                                                           |
| `src/modules/wallets/dto/wallet.dto.ts`               | Customer DTOs + response schemas                                            |
| `src/modules/wallets/dto/admin-wallet.dto.ts`         | Admin DTOs                                                                  |
| `src/modules/wallets/wallets.module.ts`               | Wiring                                                                      |
| `src/worker/handlers/wallet-dva.handler.ts`           | Drains `wallet.dva_requested` → Paystack customer + DVA                     |
| `scripts/backfill-wallets.ts`                         | Cutover backfill for existing customers                                     |

**TypeScript (modified):**

`src/common/errors/error-codes.ts`, `src/common/errors/database-error.ts`, `src/config/env.ts`, `src/domain/admin-permissions.ts`, `src/domain/payments.ts`, `src/modules/payments/paystack-webhook.service.ts`, `src/modules/payments/paystack.client.ts`, `src/modules/payments/payments.types.ts`, `src/modules/orders/dto/create-order.dto.ts`, `src/modules/orders/orders.types.ts`, `src/modules/orders/orders.service.ts`, `src/modules/orders/orders.repository.ts`, `src/modules/orders/orders.module.ts`, `src/modules/capability-modules.ts`, `src/worker/worker.module.ts`, `src/cron.ts`.

---

## Task 1: `platform_settings` table

**Files:**

- Create: `supabase/migrations/20260727000100_platform_settings.sql`
- Test: `supabase/tests/database/070_platform_settings_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/070_platform_settings_test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

select has_table('public', 'platform_settings', 'platform_settings table exists');

select is(
  public.platform_setting_int('wallet_min_topup_kobo', 0),
  50000,
  'minimum top-up seeds to ₦500'
);

select is(
  public.platform_setting_int('wallet_max_balance_kobo', 0),
  5000000,
  'maximum balance seeds to ₦50,000'
);

select is(
  public.platform_setting_int('no_such_setting', 4242),
  4242,
  'unknown keys fall back to the supplied default'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:reset && supabase test db`
Expected: FAIL — `relation "public.platform_settings" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000100_platform_settings.sql`:

```sql
begin;

-- Generic operator-tunable settings. Until now every tunable value was either an
-- environment variable or a column on vendors/campuses/campus_zones, which meant a
-- deploy to change a number. Slice A introduces the wallet limits here; slice B
-- (fee splits) reuses the same table.
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_settings_key_not_blank check (length(btrim(key)) > 0)
);

comment on table public.platform_settings is 'Operator-tunable platform configuration as key/jsonb pairs. Edited by admins through PATCH /admin/settings and audited.';
comment on column public.platform_settings.value is 'Raw jsonb. Integer settings store a bare JSON number, e.g. 50000.';

create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

-- Read an integer setting, falling back to p_default when the key is absent or is
-- not a JSON number. Callers pass the same default the application would use so a
-- missing row can never change pricing behaviour.
create or replace function public.platform_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer end
      from public.platform_settings s
      where s.key = p_key
    ),
    p_default
  );
$$;

comment on function public.platform_setting_int(text, integer) is 'Reads an integer platform setting, returning p_default when the key is missing or not a JSON number.';

insert into public.platform_settings (key, value, description)
values
  ('wallet_min_topup_kobo', to_jsonb(50000), 'Advisory minimum wallet top-up in kobo (₦500). UI guidance only — inbound transfers are always credited in full.'),
  ('wallet_max_balance_kobo', to_jsonb(5000000), 'Advisory maximum wallet balance in kobo (₦50,000). Credits crossing it still apply and raise an admin flag.')
on conflict (key) do nothing;

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm db:reset && supabase test db`
Expected: `070_platform_settings_test.sql .. ok`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260727000100_platform_settings.sql supabase/tests/database/070_platform_settings_test.sql && git commit -m "feat(settings): add generic platform_settings table with wallet limit seeds"
```

---

## Task 2: Enum values (isolated migration)

**Files:**

- Create: `supabase/migrations/20260727000150_wallet_enum_values.sql`
- Test: `supabase/tests/database/071_wallet_enum_values_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/071_wallet_enum_values_test.sql`:

```sql
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:reset && supabase test db`
Expected: FAIL — the three `ok(...)` assertions return false.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000150_wallet_enum_values.sql`. This file adds enum values and **nothing else** — Postgres refuses to use a value added by `alter type ... add value` in the same transaction, and every migration here runs inside `begin; ... commit;`.

```sql
begin;

-- Enum values only. Postgres cannot USE a value added by `alter type ... add value`
-- inside the transaction that added it, and each migration file is one transaction.
-- Everything that references these values lives in 20260727000200 and later.

alter type public.payment_provider add value if not exists 'wallet';

alter type public.payment_reconciliation_issue_type add value if not exists 'wallet_balance_drift';
alter type public.payment_reconciliation_issue_type add value if not exists 'wallet_balance_cap_exceeded';

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm db:reset && supabase test db`
Expected: `071_wallet_enum_values_test.sql .. ok`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260727000150_wallet_enum_values.sql supabase/tests/database/071_wallet_enum_values_test.sql && git commit -m "feat(wallet): add wallet payment provider and wallet reconciliation issue enum values"
```

---

## Task 3: Wallet tables, ledger and top-up crediting

**Files:**

- Create: `supabase/migrations/20260727000200_wallets.sql`
- Test: `supabase/tests/database/072_wallet_ledger_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/072_wallet_ledger_test.sql`. The seed user `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1` is the customer already used by `025_order_function_rules_test.sql`.

```sql
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
  'P0001',
  null,
  'ledger entries cannot be updated'
);

select throws_ok(
  $$ delete from public.wallet_ledger_entries $$,
  'P0001',
  null,
  'ledger entries cannot be deleted'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:reset && supabase test db`
Expected: FAIL — `function public.ensure_customer_wallet(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000200_wallets.sql`:

```sql
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm db:reset && supabase test db`
Expected: `072_wallet_ledger_test.sql .. ok`

- [ ] **Step 5: Regenerate database types**

Run: `pnpm db:types`
Expected: `supabase/types/database.types.ts` now contains `wallets`, `wallet_ledger_entries`, `wallet_dedicated_accounts`, `platform_settings`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260727000200_wallets.sql supabase/tests/database/072_wallet_ledger_test.sql supabase/types/database.types.ts && git commit -m "feat(wallet): add wallets, append-only ledger, dedicated accounts and top-up crediting"
```

---

## Task 4: `create_paid_order_from_wallet` RPC

The atomic checkout. Body is the reservation logic from `create_pending_order_and_reserve_inventory` (`supabase/migrations/20260706000200_order_soup_and_max_quantity.sql`) with the payment tail replaced: lock wallet → debit → insert order at `paid` → sell through inventory → batch → `payment.successful`.

`MDW01` is a custom SQLSTATE the API maps to HTTP 402. `detail` carries the shortfall as JSON.

**Files:**

- Create: `supabase/migrations/20260727000300_create_paid_order_from_wallet.sql`
- Test: `supabase/tests/database/073_wallet_order_payment_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/073_wallet_order_payment_test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

-- Empty wallet cannot pay.
select throws_ok(
  $$ select public.create_paid_order_from_wallet(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
       'pgtap-wallet-broke',
       'hash-wallet-broke'
     ) $$,
  'MDW01',
  null,
  'an empty wallet is rejected with the insufficient-balance SQLSTATE'
);

select is(
  (select count(*)::integer from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  0,
  'no order survives the rejected wallet payment'
);

select is(
  (select coalesce(sum(quantity_reserved), 0)::integer from public.menu_item_inventory
   where menu_item_id = '61111111-1111-1111-1111-111111111111'),
  0,
  'the inventory reservation was rolled back with the transaction'
);

-- Fund the wallet generously, then pay.
select public.credit_wallet_topup(
  'PSTK-FUND-1', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1000000, 'ADA LOVELACE', '{}'::jsonb
);

select lives_ok(
  $$ select public.create_paid_order_from_wallet(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
       'pgtap-wallet-pays',
       'hash-wallet-pays'
     ) $$,
  'a funded wallet pays for the order'
);

select is(
  (select order_status::text from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'paid',
  'the order lands directly at paid'
);

select is(
  (select payment_method::text from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'wallet',
  'the order records the wallet as its funding source'
);

-- Balance = credit minus the order total; a matching debit entry exists.
select is(
  (select w.balance_kobo from public.wallets w where w.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1000000 - (select total_kobo from public.orders where customer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'the wallet was debited by exactly the order total'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:reset && supabase test db`
Expected: FAIL — `function public.create_paid_order_from_wallet(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000300_create_paid_order_from_wallet.sql`:

```sql
begin;

-- Wallet checkout in one transaction. Everything before the wallet lock is the reservation
-- logic of create_pending_order_and_reserve_inventory (cutoff, per-unit max quantity,
-- required soup, spoon limit, zone delivery fee, service fee, promotion, large-order
-- surcharge). The tail differs: instead of leaving a pending_payment order for a webhook,
-- it debits the wallet, inserts the order at `paid`, sells the reservation through, and
-- batches the order — the same end state mark_verified_payment_successful reaches.
--
-- Insufficient balance raises SQLSTATE MDW01 with a JSON detail carrying the shortfall.
-- The API maps MDW01 to HTTP 402 / WALLET_INSUFFICIENT_BALANCE. Because the raise aborts
-- the transaction, the inventory reservation taken above is released automatically.
create or replace function public.create_paid_order_from_wallet(
  p_customer_id uuid,
  p_campus_id uuid,
  p_vendor_id uuid,
  p_service_date date,
  p_delivery_slot_id uuid,
  p_location_id uuid,
  p_delivery_mode public.delivery_mode,
  p_items jsonb,
  p_idempotency_key text,
  p_request_hash text default null,
  p_promotion_code text default null,
  p_special_instructions text default null,
  p_service_fee_kobo integer default 0,
  p_max_order_total_kobo integer default 249000,
  p_large_order_surcharge_bps integer default 150,
  p_large_order_surcharge_flat_kobo integer default 10000,
  p_accept_large_order boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_resource_id uuid;
  v_location_zone_id uuid;
  v_delivery_fee integer;
  v_service_fee integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_food_subtotal integer := 0;
  v_spoon_units integer := 0;
  v_delivery_mode public.delivery_mode;
  v_item record;
  v_catalog record;
  v_inventory record;
  v_remaining integer;
  v_promo record;
  v_discount integer := 0;
  v_total integer;
  v_surcharge integer := 0;
  v_wallet_id uuid;
  v_wallet_status public.wallet_status;
  v_balance integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item' using errcode = '23514';
  end if;

  v_service_fee := greatest(coalesce(p_service_fee_kobo, 0), 0);

  select resource_id
  into v_existing_resource_id
  from public.idempotency_keys
  where actor_user_id = p_customer_id
    and operation = 'create_order'
    and idempotency_key = p_idempotency_key
    and expires_at > now();

  if v_existing_resource_id is not null then
    return v_existing_resource_id;
  end if;

  insert into public.idempotency_keys (
    actor_user_id, operation, idempotency_key, request_hash, expires_at
  )
  values (
    p_customer_id, 'create_order', p_idempotency_key, p_request_hash, now() + interval '24 hours'
  )
  on conflict (actor_user_id, operation, idempotency_key) do nothing;

  select cl.zone_id, coalesce(cz.delivery_fee_kobo, 15000)
  into v_location_zone_id, v_delivery_fee
  from public.campus_locations cl
  join public.campus_zones cz on cz.id = cl.zone_id
  where cl.id = p_location_id
    and cl.campus_id = p_campus_id
    and cl.active;

  if v_location_zone_id is null then
    raise exception 'delivery location is not active for campus' using errcode = '23514';
  end if;

  if now() >= public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id) then
    raise exception 'orders are closed for this delivery slot' using errcode = '23514';
  end if;

  select coalesce(p_delivery_mode, v.default_delivery_mode)
  into v_delivery_mode
  from public.vendors v
  where v.id = p_vendor_id
    and v.campus_id = p_campus_id
    and v.status = 'approved'
    and v.active;

  if v_delivery_mode is null then
    raise exception 'vendor is not active for campus' using errcode = '23514';
  end if;

  for v_item in
    select menu_item_id::uuid, quantity::integer, soup_option_id::uuid
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer, soup_option_id uuid)
  loop
    if v_item.quantity <= 0 then
      raise exception 'item quantity must be positive' using errcode = '23514';
    end if;

    select mi.name,
           mi.price_kobo,
           mi.requires_soup,
           ut.code as unit_code,
           ut.counts_toward_spoon_limit,
           ut.max_quantity
    into v_catalog
    from public.menu_items mi
    join public.unit_types ut on ut.id = mi.unit_type_id
    where mi.id = v_item.menu_item_id
      and mi.vendor_id = p_vendor_id
      and mi.active
      and ut.active;

    if not found then
      raise exception 'menu item % is not active for vendor', v_item.menu_item_id using errcode = '23514';
    end if;

    if v_catalog.max_quantity is not null and v_item.quantity > v_catalog.max_quantity then
      raise exception 'menu item % exceeds its maximum quantity of % per order', v_item.menu_item_id, v_catalog.max_quantity using errcode = '23514';
    end if;

    if v_catalog.requires_soup then
      if v_item.soup_option_id is null then
        raise exception 'menu item % requires a soup selection', v_item.menu_item_id using errcode = '23514';
      end if;
      if not exists (
        select 1
        from public.vendor_soup_options so
        where so.id = v_item.soup_option_id
          and so.vendor_id = p_vendor_id
          and so.active
      ) then
        raise exception 'soup selection % is not valid for menu item %', v_item.soup_option_id, v_item.menu_item_id using errcode = '23514';
      end if;
    end if;

    if not exists (
      select 1
      from public.available_menu_items(p_campus_id, p_service_date, p_delivery_slot_id) ami
      where ami.menu_item_id = v_item.menu_item_id
        and ami.vendor_id = p_vendor_id
    ) then
      raise exception 'menu item % is not orderable for this date and slot', v_item.menu_item_id using errcode = '23514';
    end if;

    select inv.id,
           inv.quantity_total,
           inv.quantity_adjusted,
           inv.quantity_reserved,
           inv.quantity_sold,
           inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold as remaining_quantity
    into v_inventory
    from public.menu_item_inventory inv
    where inv.menu_item_id = v_item.menu_item_id
      and inv.service_date = p_service_date
      and inv.delivery_slot_id = p_delivery_slot_id
      and inv.active
    for update;

    if not found then
      raise exception 'inventory missing for menu item %', v_item.menu_item_id using errcode = '23514';
    end if;

    v_remaining := v_inventory.remaining_quantity;
    if v_remaining < v_item.quantity then
      raise exception 'insufficient inventory for menu item %', v_item.menu_item_id using errcode = '23514';
    end if;

    update public.menu_item_inventory
    set quantity_reserved = quantity_reserved + v_item.quantity,
        version = version + 1
    where id = v_inventory.id;

    v_food_subtotal := v_food_subtotal + (v_catalog.price_kobo * v_item.quantity);
    if v_catalog.counts_toward_spoon_limit then
      v_spoon_units := v_spoon_units + v_item.quantity;
    end if;
  end loop;

  if v_spoon_units > 3 then
    raise exception 'one takeaway package cannot contain more than three spoon-based units' using errcode = '23514';
  end if;

  if p_promotion_code is not null then
    select * into v_promo
    from public.promotions
    where code = p_promotion_code
      and active
    for update;

    if not found then
      raise exception 'promotion code is not valid' using errcode = '23514';
    end if;

    if now() < v_promo.starts_at or (v_promo.ends_at is not null and now() > v_promo.ends_at) then
      raise exception 'promotion code is not currently active' using errcode = '23514';
    end if;

    if v_food_subtotal < v_promo.min_order_kobo then
      raise exception 'order subtotal is below the promotion minimum' using errcode = '23514';
    end if;

    if (select count(*) from public.promotion_redemptions where promotion_id = v_promo.id and user_id = p_customer_id) >= v_promo.per_user_limit then
      raise exception 'promotion code usage limit reached for this user' using errcode = '23514';
    end if;

    if v_promo.total_usage_limit is not null
       and (select count(*) from public.promotion_redemptions where promotion_id = v_promo.id) >= v_promo.total_usage_limit then
      raise exception 'promotion code usage limit reached' using errcode = '23514';
    end if;

    if v_promo.discount_type = 'fixed' then
      v_discount := v_promo.discount_value;
    else
      v_discount := floor((v_food_subtotal * v_promo.discount_value) / 100.0);
      if v_promo.max_discount_kobo is not null then
        v_discount := least(v_discount, v_promo.max_discount_kobo);
      end if;
    end if;

    v_discount := least(v_discount, v_food_subtotal);
  end if;

  v_total := v_food_subtotal + v_delivery_fee + v_service_fee - v_discount;

  if p_max_order_total_kobo is not null and v_total > p_max_order_total_kobo then
    if not coalesce(p_accept_large_order, false) then
      raise exception 'order total exceeds the standard maximum; large-order surcharge not accepted' using errcode = '23514';
    end if;

    v_surcharge := (
      round(v_total::numeric * coalesce(p_large_order_surcharge_bps, 0)::numeric / 10000.0)
      + greatest(coalesce(p_large_order_surcharge_flat_kobo, 0), 0)
    )::integer;
    v_total := v_total + v_surcharge;
  end if;

  -- ---- wallet leg ---------------------------------------------------------------
  v_wallet_id := public.ensure_customer_wallet(p_customer_id);

  select status, balance_kobo
  into v_wallet_status, v_balance
  from public.wallets
  where id = v_wallet_id
  for update;

  if v_wallet_status = 'frozen' then
    raise exception 'wallet is frozen and cannot pay for orders' using errcode = '23514';
  end if;

  if v_balance < v_total then
    raise exception 'wallet balance is insufficient for this order'
      using errcode = 'MDW01',
            detail = jsonb_build_object(
              'balanceKobo', v_balance,
              'requiredKobo', v_total,
              'shortfallKobo', v_total - v_balance
            )::text;
  end if;

  insert into public.orders (
    customer_id, campus_id, vendor_id, service_date, delivery_slot_id, location_id,
    zone_id, delivery_mode, food_subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
    discount_kobo, large_order_surcharge_kobo, total_kobo, special_instructions,
    payment_method, order_status, paid_at, inventory_reservation_expires_at
  )
  values (
    p_customer_id, p_campus_id, p_vendor_id, p_service_date, p_delivery_slot_id, p_location_id,
    v_location_zone_id, v_delivery_mode, v_food_subtotal, v_delivery_fee, v_service_fee,
    v_discount, v_surcharge, v_total, nullif(btrim(coalesce(p_special_instructions, '')), ''),
    'wallet', 'paid', now(),
    public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id)
  )
  returning id, order_number into v_order_id, v_order_number;

  perform public.append_wallet_ledger_entry(
    v_wallet_id,
    'order_payment',
    -v_total,
    v_order_id,
    v_order_number,
    p_customer_id,
    'order paid from wallet balance',
    jsonb_build_object('order_number', v_order_number)
  );

  if p_promotion_code is not null then
    insert into public.promotion_redemptions (promotion_id, user_id, order_id, discount_kobo)
    values (v_promo.id, p_customer_id, v_order_id, v_discount);
  end if;

  for v_item in
    select menu_item_id::uuid, quantity::integer, customization, soup_option_id::uuid
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer, customization jsonb, soup_option_id uuid)
  loop
    select mi.name, mi.price_kobo, mi.requires_soup, ut.code as unit_code
    into v_catalog
    from public.menu_items mi
    join public.unit_types ut on ut.id = mi.unit_type_id
    where mi.id = v_item.menu_item_id;

    insert into public.order_items (
      order_id, menu_item_id, item_name, unit_type, unit_price_kobo,
      quantity, line_total_kobo, customization, soup_option_id
    )
    values (
      v_order_id, v_item.menu_item_id, v_catalog.name, v_catalog.unit_code, v_catalog.price_kobo,
      v_item.quantity, v_catalog.price_kobo * v_item.quantity,
      case
        when v_item.customization is null or jsonb_typeof(v_item.customization) <> 'object'
          then '{}'::jsonb
        else v_item.customization
      end,
      case when v_catalog.requires_soup then v_item.soup_option_id else null end
    );
  end loop;

  -- Reservation → sold, exactly as mark_verified_payment_successful does for card orders.
  update public.menu_item_inventory inv
  set quantity_reserved = inv.quantity_reserved - oi.quantity,
      quantity_sold = inv.quantity_sold + oi.quantity,
      version = inv.version + 1
  from public.order_items oi
  where oi.order_id = v_order_id
    and inv.menu_item_id = oi.menu_item_id
    and inv.service_date = p_service_date
    and inv.delivery_slot_id = p_delivery_slot_id;

  insert into public.order_status_history (order_id, from_status, to_status, actor_user_id, reason)
  values (v_order_id, null, 'paid', p_customer_id, 'order paid from wallet balance');

  -- One uniform money path: wallet orders still get a payments row, so admin payment
  -- lists, settlements and audit keep working without a second, invisible ledger.
  insert into public.payments (
    order_id, provider, provider_reference, provider_transaction_id, status,
    expected_amount_kobo, paid_amount_kobo, verified_at, paid_at
  )
  values (
    v_order_id, 'wallet', v_order_number, v_order_number, 'successful',
    v_total, v_total, now(), now()
  );

  perform public.add_paid_order_to_batch(v_order_id);

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'payment.successful',
    'order',
    v_order_id,
    jsonb_build_object('provider_reference', v_order_number, 'payment_method', 'wallet')
  );

  update public.idempotency_keys
  set response_status = 201,
      response_body = jsonb_build_object('order_id', v_order_id),
      resource_id = v_order_id
  where actor_user_id = p_customer_id
    and operation = 'create_order'
    and idempotency_key = p_idempotency_key;

  return v_order_id;
end;
$$;

comment on function public.create_paid_order_from_wallet(uuid, uuid, uuid, date, uuid, uuid, public.delivery_mode, jsonb, text, text, text, text, integer, integer, integer, integer, boolean) is 'Creates an order already paid from the customer wallet in one transaction: reserves inventory under row locks with the same cutoff/spoon/max-quantity/soup/promotion/surcharge rules as the pending path, locks and debits the wallet (SQLSTATE MDW01 when short), inserts the order at paid, sells the reservation through, batches it, writes a wallet payments row and emits payment.successful.';

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm db:reset && supabase test db`
Expected: `073_wallet_order_payment_test.sql .. ok`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260727000300_create_paid_order_from_wallet.sql supabase/tests/database/073_wallet_order_payment_test.sql && git commit -m "feat(wallet): add atomic create_paid_order_from_wallet checkout RPC"
```

---

## Task 5: Admin wallet operations, refund-to-wallet and drift detection

**Files:**

- Create: `supabase/migrations/20260727000400_wallet_admin_and_reconciliation.sql`
- Test: `supabase/tests/database/074_wallet_admin_reconciliation_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/074_wallet_admin_reconciliation_test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select public.ensure_customer_wallet('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

-- Admin adjustment requires a reason.
select throws_ok(
  $$ select public.admin_adjust_wallet(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       100000,
       '   ',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
     ) $$,
  '23514',
  null,
  'a blank reason is rejected'
);

select lives_ok(
  $$ select public.admin_adjust_wallet(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       100000,
       'goodwill credit',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
     ) $$,
  'an adjustment with a reason is accepted'
);

select is(
  (select balance_kobo from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  100000,
  'the adjustment moved the balance'
);

-- A frozen wallet still receives credits.
select lives_ok(
  $$ select public.set_wallet_status(
       (select id from public.wallets where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
       'frozen'::public.wallet_status
     ) $$,
  'a wallet can be frozen'
);

select lives_ok(
  $$ select public.credit_wallet_topup(
       'PSTK-FROZEN-1', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 50000, 'ADA LOVELACE', '{}'::jsonb
     ) $$,
  'a frozen wallet still accepts credits'
);

-- Drift detection files a critical issue when the cache disagrees with the ledger.
select is(
  public.detect_wallet_balance_drift(),
  0,
  'a consistent wallet produces no drift issues'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:reset && supabase test db`
Expected: FAIL — `function public.admin_adjust_wallet(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000400_wallet_admin_and_reconciliation.sql`:

```sql
begin;

-- Administrator creating or destroying balance. This is the only path that writes a ledger
-- entry with no provider reference, so it demands a reason and records the acting admin.
-- The API layer additionally gates it behind @RequirePermission('wallets:manage') and
-- writes an audit_logs row.
create or replace function public.admin_adjust_wallet(
  p_wallet_id uuid,
  p_amount_kobo integer,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'a reason is required for a wallet adjustment' using errcode = '23514';
  end if;

  return public.append_wallet_ledger_entry(
    p_wallet_id,
    'adjustment',
    p_amount_kobo,
    null,
    null,
    p_actor_user_id,
    v_reason,
    jsonb_build_object('source', 'admin_adjustment')
  );
end;
$$;

comment on function public.admin_adjust_wallet(uuid, integer, text, uuid) is 'Admin-created signed wallet adjustment. Requires a non-blank reason and records the acting admin on the ledger entry.';

create or replace function public.set_wallet_status(
  p_wallet_id uuid,
  p_status public.wallet_status
)
returns public.wallet_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.wallet_status;
begin
  update public.wallets
  set status = p_status
  where id = p_wallet_id
  returning status into v_status;

  if not found then
    raise exception 'wallet % not found', p_wallet_id using errcode = 'P0002';
  end if;

  return v_status;
end;
$$;

comment on function public.set_wallet_status(uuid, public.wallet_status) is 'Freezes or unfreezes a wallet. A frozen wallet cannot pay for orders but still receives credits.';

-- Refunds always land in the wallet: instant, no Paystack refund fee, no 3–10 day wait.
-- The card-refund path in refunds.service.ts stays available to admins for disputes.
create or replace function public.refund_order_to_wallet(
  p_order_id uuid,
  p_amount_kobo integer,
  p_reason text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_wallet_id uuid;
begin
  select customer_id into v_customer_id
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'refund amount must be positive' using errcode = '23514';
  end if;

  v_wallet_id := public.ensure_customer_wallet(v_customer_id);

  return public.append_wallet_ledger_entry(
    v_wallet_id,
    'order_refund',
    p_amount_kobo,
    p_order_id,
    null,
    p_actor_user_id,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'order refunded to wallet'),
    jsonb_build_object('source', 'order_refund')
  );
end;
$$;

comment on function public.refund_order_to_wallet(uuid, integer, text, uuid) is 'Credits a refund straight to the order customer wallet and links the ledger entry to the order.';

-- Nightly invariant: the cached balance must equal the sum of the ledger. Any mismatch is
-- a critical finance issue — it means a balance moved outside append_wallet_ledger_entry.
create or replace function public.detect_wallet_balance_drift()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_detected integer := 0;
begin
  for v_row in
    select w.id as wallet_id,
           w.user_id,
           w.balance_kobo,
           coalesce(sum(e.amount_kobo), 0)::integer as ledger_total
    from public.wallets w
    left join public.wallet_ledger_entries e on e.wallet_id = w.id
    group by w.id, w.user_id, w.balance_kobo
    having w.balance_kobo <> coalesce(sum(e.amount_kobo), 0)::integer
  loop
    perform public.upsert_payment_reconciliation_issue(
      'wallet_balance_drift:' || v_row.wallet_id::text,
      'wallet_balance_drift'::public.payment_reconciliation_issue_type,
      'critical'::public.payment_reconciliation_severity,
      null,
      null,
      null,
      jsonb_build_object(
        'walletId', v_row.wallet_id,
        'userId', v_row.user_id,
        'cachedBalanceKobo', v_row.balance_kobo,
        'ledgerTotalKobo', v_row.ledger_total,
        'driftKobo', v_row.balance_kobo - v_row.ledger_total
      )
    );
    v_detected := v_detected + 1;
  end loop;

  return v_detected;
end;
$$;

comment on function public.detect_wallet_balance_drift() is 'Asserts wallets.balance_kobo equals the sum of that wallet ledger; files a critical wallet_balance_drift reconciliation issue per mismatch and returns the count.';

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm db:reset && supabase test db`
Expected: `074_wallet_admin_reconciliation_test.sql .. ok`

- [ ] **Step 5: Run the whole database suite and the lints**

Run: `pnpm db:ci`
Expected: all pgTAP files pass, `supabase db lint` clean, `db:diff:check` reports no drift.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260727000400_wallet_admin_and_reconciliation.sql supabase/tests/database/074_wallet_admin_reconciliation_test.sql supabase/types/database.types.ts && git commit -m "feat(wallet): add admin adjustment, freeze, refund-to-wallet and balance drift detection"
```

---

## Task 6: Error code, SQLSTATE → 402 mapping, and env flag

**Files:**

- Create: `src/domain/wallet.ts`
- Modify: `src/common/errors/error-codes.ts`, `src/common/errors/database-error.ts`, `src/config/env.ts`
- Test: `test/unit/wallet-error-mapping.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/wallet-error-mapping.spec.ts`:

```ts
import { HttpStatus } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { mapDatabaseError } from '../../src/common/errors/database-error.js';
import { walletInsufficientBalanceSqlState } from '../../src/domain/wallet.js';

function databaseError(code: string, message: string, detail?: string): DatabaseError {
  const error = new DatabaseError(message, 0, 'error');
  error.code = code;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
}

describe('wallet database error mapping', () => {
  it('maps the insufficient-balance SQLSTATE to 402 with the shortfall', () => {
    const mapped = mapDatabaseError(
      databaseError(
        walletInsufficientBalanceSqlState,
        'wallet balance is insufficient for this order',
        JSON.stringify({ balanceKobo: 10000, requiredKobo: 45000, shortfallKobo: 35000 })
      )
    );

    expect(mapped?.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(mapped?.getResponse()).toEqual({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'wallet balance is insufficient for this order',
      details: { balanceKobo: 10000, requiredKobo: 45000, shortfallKobo: 35000 }
    });
  });

  it('still returns 402 when the detail payload is missing or unparseable', () => {
    const mapped = mapDatabaseError(
      databaseError(walletInsufficientBalanceSqlState, 'wallet balance is insufficient', 'not json')
    );

    expect(mapped?.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(mapped?.getResponse()).toEqual({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'wallet balance is insufficient'
    });
  });

  it('leaves other SQLSTATEs on their existing mappings', () => {
    expect(mapDatabaseError(databaseError('23514', 'wallet is frozen'))?.getStatus()).toBe(
      HttpStatus.BAD_REQUEST
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/wallet-error-mapping.spec.ts`
Expected: FAIL — `Cannot find module '../../src/domain/wallet.js'`.

- [ ] **Step 3: Create the wallet domain module**

Create `src/domain/wallet.ts`:

```ts
// Custom SQLSTATE raised by public.create_paid_order_from_wallet when the balance is short.
// Postgres reserves classes 00–42 and 5x; MDW is a MealDirect-private class, so it can never
// collide with a server-generated code.
export const walletInsufficientBalanceSqlState = 'MDW01';

export const walletStatuses = ['active', 'frozen'] as const;
export type WalletStatus = (typeof walletStatuses)[number];

export const walletEntryTypes = [
  'topup',
  'order_payment',
  'order_refund',
  'adjustment',
  'reversal'
] as const;
export type WalletEntryType = (typeof walletEntryTypes)[number];

export const dedicatedAccountStatuses = ['pending', 'active', 'failed', 'deactivated'] as const;
export type DedicatedAccountStatus = (typeof dedicatedAccountStatuses)[number];

export const orderPaymentMethods = ['wallet', 'paystack'] as const;
export type OrderPaymentMethod = (typeof orderPaymentMethods)[number];

export type WalletShortfall = {
  balanceKobo: number;
  requiredKobo: number;
  shortfallKobo: number;
};

/**
 * The RPC attaches the shortfall to the error's DETAIL field as JSON. Parsing is
 * best-effort: a 402 without numbers is still far more useful than a 500.
 */
export function parseWalletShortfall(detail: string | undefined): WalletShortfall | undefined {
  if (detail === undefined || detail.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { balanceKobo, requiredKobo, shortfallKobo } = parsed as Record<string, unknown>;
    if (
      typeof balanceKobo !== 'number' ||
      typeof requiredKobo !== 'number' ||
      typeof shortfallKobo !== 'number'
    ) {
      return undefined;
    }
    return { balanceKobo, requiredKobo, shortfallKobo };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Add the error code**

In `src/common/errors/error-codes.ts`, add the entry after `AUTH_FAILED`:

```ts
export const ErrorCodes = {
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_FAILED: 'AUTH_FAILED',
  WALLET_INSUFFICIENT_BALANCE: 'WALLET_INSUFFICIENT_BALANCE'
} as const;
```

- [ ] **Step 5: Map the SQLSTATE**

In `src/common/errors/database-error.ts`, add the imports and the mapping entry. Replace the import block and the `sqlStateMappings` object:

```ts
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException
} from '@nestjs/common';
import { DatabaseError } from 'pg';

import { parseWalletShortfall, walletInsufficientBalanceSqlState } from '../../domain/wallet.js';
import { ErrorCodes } from './error-codes.js';

type DatabaseErrorMapping = (message: string, detail?: string) => HttpException;
```

Then add one entry inside `sqlStateMappings`, after the `P0002` line:

```ts
  // Wallet balance short of the order total. Payment Required is the honest status:
  // nothing is wrong with the request, the customer just needs to top up.
  [walletInsufficientBalanceSqlState]: (message, detail) => {
    const shortfall = parseWalletShortfall(detail);
    return new HttpException(
      {
        code: ErrorCodes.WALLET_INSUFFICIENT_BALANCE,
        message,
        ...(shortfall === undefined ? {} : { details: shortfall })
      },
      HttpStatus.PAYMENT_REQUIRED
    );
  }
```

And pass the detail through at the call site — change the final line of `mapDatabaseError`:

```ts
return mapping(exception.message, exception.detail);
```

- [ ] **Step 6: Add the environment flag**

In `src/config/env.ts`, add after `PAYOUTS_ENABLED`:

```ts
    PAYOUTS_ENABLED: booleanFromString.default(false),
    // Gates the Paystack dedicated-virtual-account path. DVA is not yet enabled on the
    // MealDirect Paystack account; until support approves it this stays false, wallets
    // exist with no account number, and top-ups are funded through a checkout link.
    WALLET_DVA_ENABLED: booleanFromString.default(false),
    // Paystack DVA provider for live traffic. 'test-bank' is the only provider that
    // works in Paystack test mode.
    WALLET_DVA_PROVIDER: z.string().min(1).default('test-bank')
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/wallet-error-mapping.spec.ts test/unit/env.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/wallet.ts src/common/errors src/config/env.ts test/unit/wallet-error-mapping.spec.ts && git commit -m "feat(wallet): add wallet domain types, 402 insufficient-balance mapping and DVA env flags"
```

---

## Task 7: `wallets:manage` admin permission

**Files:**

- Modify: `src/domain/admin-permissions.ts`
- Test: `test/unit/admin-permissions.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/admin-permissions.spec.ts`:

```ts
describe('wallets:manage', () => {
  it('is granted to finance admins', () => {
    expect(resolveAdminPermissions(['finance_admin'], 'campus_admin').has('wallets:manage')).toBe(
      true
    );
  });

  it('is granted to campus admins', () => {
    expect(resolveAdminPermissions(['campus_admin'], 'campus_admin').has('wallets:manage')).toBe(
      true
    );
  });

  it('is withheld from support and readonly admins', () => {
    expect(resolveAdminPermissions(['support_admin'], 'campus_admin').has('wallets:manage')).toBe(
      false
    );
    expect(resolveAdminPermissions(['readonly_admin'], 'campus_admin').has('wallets:manage')).toBe(
      false
    );
  });

  it('is granted to super admins by coarse role alone', () => {
    expect(resolveAdminPermissions([], 'super_admin').has('wallets:manage')).toBe(true);
  });
});
```

Make sure `resolveAdminPermissions` is imported at the top of that file (it already is).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/admin-permissions.spec.ts`
Expected: FAIL — TypeScript rejects `'wallets:manage'` as an `AdminPermission`.

- [ ] **Step 3: Add the permission**

In `src/domain/admin-permissions.ts`, add to `adminPermissions` after `'refunds:manage'`:

```ts
export const adminPermissions = [
  'read',
  'payments:verify',
  'refunds:manage',
  'wallets:manage',
  'settlements:manage',
  'reconciliation:manage',
  'vendors:manage',
  'riders:manage',
  'users:manage',
  'admin:manage'
] as const;
```

Then grant it in `adminRolePermissions` — add `'wallets:manage'` to the `campus_admin` list and to the `finance_admin` list:

```ts
  campus_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'wallets:manage',
    'settlements:manage',
    'reconciliation:manage',
    'vendors:manage',
    'riders:manage',
    'users:manage'
  ],
  finance_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'wallets:manage',
    'settlements:manage',
    'reconciliation:manage'
  ],
```

`super_admin` already receives `ALL`; `operations_admin`, `support_admin` and `readonly_admin` are unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/admin-permissions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/admin-permissions.ts test/unit/admin-permissions.spec.ts && git commit -m "feat(admin): add wallets:manage granular permission for finance and campus admins"
```

---

## Task 8: Wallet types and repository

**Files:**

- Create: `src/modules/wallets/wallets.types.ts`, `src/modules/wallets/wallets.repository.ts`, `src/modules/wallets/platform-settings.repository.ts`

No test in this task — the repository is raw SQL with no branching logic worth a unit test, and Task 9 exercises it through a fake. The SQL itself is covered by the pgTAP tests in Tasks 3–5 and by the integration test in Task 12.

- [ ] **Step 1: Write the types**

Create `src/modules/wallets/wallets.types.ts`:

```ts
import type { DedicatedAccountStatus, WalletEntryType, WalletStatus } from '../../domain/wallet.js';

export type DedicatedAccountRecord = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
};

export type WalletRecord = {
  id: string;
  userId: string;
  balanceKobo: number;
  currency: string;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerWalletView = {
  balanceKobo: number;
  currency: string;
  status: WalletStatus;
  minTopupKobo: number;
  maxBalanceKobo: number;
  dedicatedAccount: DedicatedAccountRecord | null;
};

export type WalletLedgerEntryRecord = {
  id: string;
  entryType: WalletEntryType;
  amountKobo: number;
  balanceAfterKobo: number;
  orderId: string | null;
  orderNumber: string | null;
  providerReference: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminWalletRecord = WalletRecord & {
  userEmail: string | null;
  userDisplayName: string | null;
  accountNumber: string | null;
  overCap: boolean;
};

export type WalletPage<T> = {
  items: T[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type WalletLimits = {
  minTopupKobo: number;
  maxBalanceKobo: number;
};

export type PlatformSettingRecord = {
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type DedicatedAccountUpsert = {
  walletId: string;
  paystackCustomerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
  providerPayload: Record<string, unknown>;
};

export type WalletsRepositoryContract = {
  ensureWallet(userId: string): Promise<string>;
  findWalletByUserId(userId: string): Promise<WalletRecord | undefined>;
  findWalletById(walletId: string): Promise<WalletRecord | undefined>;
  findDedicatedAccount(walletId: string): Promise<DedicatedAccountRecord | null>;
  listLedgerEntries(
    walletId: string,
    pagination: { cursor?: string; limit: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>>;
  listWallets(
    pagination: { cursor?: string; limit: number },
    maxBalanceKobo: number
  ): Promise<WalletPage<AdminWalletRecord>>;
  adjustWallet(
    walletId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<WalletRecord>;
  setWalletStatus(walletId: string, status: WalletStatus): Promise<WalletRecord>;
  upsertDedicatedAccount(input: DedicatedAccountUpsert): Promise<DedicatedAccountRecord>;
  listWalletIdsMissingDedicatedAccount(
    limit: number
  ): Promise<{ walletId: string; userId: string }[]>;
};
```

- [ ] **Step 2: Write the platform settings repository**

Create `src/modules/wallets/platform-settings.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { PlatformSettingRecord, WalletLimits } from './wallets.types.js';

// Defaults mirror the seeds in 20260727000100_platform_settings.sql so a wiped settings
// table degrades to the documented behaviour rather than to zero.
const defaultMinTopupKobo = 50_000;
const defaultMaxBalanceKobo = 5_000_000;

@Injectable()
export class PlatformSettingsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listSettings(): Promise<PlatformSettingRecord[]> {
    const result = await sql<PlatformSettingRecord>`
      select
        key,
        value,
        description,
        updated_by::text as "updatedBy",
        updated_at::text as "updatedAt"
      from public.platform_settings
      order by key
    `.execute(this.database.db);

    return result.rows;
  }

  async findWalletLimits(): Promise<WalletLimits> {
    const result = await sql<WalletLimits>`
      select
        public.platform_setting_int('wallet_min_topup_kobo', ${defaultMinTopupKobo}) as "minTopupKobo",
        public.platform_setting_int('wallet_max_balance_kobo', ${defaultMaxBalanceKobo}) as "maxBalanceKobo"
    `.execute(this.database.db);

    return (
      result.rows[0] ?? {
        minTopupKobo: defaultMinTopupKobo,
        maxBalanceKobo: defaultMaxBalanceKobo
      }
    );
  }

  async upsertSetting(
    key: string,
    value: unknown,
    actorUserId: string
  ): Promise<PlatformSettingRecord> {
    const result = await sql<PlatformSettingRecord>`
      insert into public.platform_settings (key, value, updated_by)
      values (${key}, ${JSON.stringify(value)}::jsonb, ${actorUserId}::uuid)
      on conflict (key) do update
      set value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()
      returning
        key,
        value,
        description,
        updated_by::text as "updatedBy",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Failed to upsert platform setting ${key}.`);
    }
    return row;
  }
}
```

- [ ] **Step 3: Write the wallets repository**

Create `src/modules/wallets/wallets.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type { WalletStatus } from '../../domain/wallet.js';
import type {
  AdminWalletRecord,
  DedicatedAccountRecord,
  DedicatedAccountUpsert,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletRecord,
  WalletsRepositoryContract
} from './wallets.types.js';

type KeysetCursor = { ts: string; id: string };

// Same {ts,id} base64url payload the admin lists already emit (AdminRepository.toList),
// so a cursor is interchangeable across the admin API surface.
function decodeKeysetCursor(cursor?: string): KeysetCursor | undefined {
  if (cursor === undefined || cursor.length === 0) return undefined;
  try {
    const payload = decodeCursor(cursor);
    if (typeof payload.ts === 'string' && typeof payload.id === 'string') {
      return { ts: payload.ts, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  tsOf: (row: T) => string
): WalletPage<T> {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    hasMore,
    limit,
    ...(hasMore && last !== undefined
      ? { nextCursor: encodeCursor({ ts: tsOf(last), id: last.id }) }
      : {})
  };
}

@Injectable()
export class WalletsRepository implements WalletsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensureWallet(userId: string): Promise<string> {
    const result = await sql<{ walletId: string }>`
      select public.ensure_customer_wallet(${userId}::uuid)::text as "walletId"
    `.execute(this.database.db);

    const walletId = result.rows[0]?.walletId;
    if (walletId === undefined) {
      throw new Error('Wallet provisioning did not return a wallet ID.');
    }
    return walletId;
  }

  async findWalletByUserId(userId: string): Promise<WalletRecord | undefined> {
    const result = await sql<WalletRecord>`
      ${this.walletSelect()}
      where w.user_id = ${userId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findWalletById(walletId: string): Promise<WalletRecord | undefined> {
    const result = await sql<WalletRecord>`
      ${this.walletSelect()}
      where w.id = ${walletId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findDedicatedAccount(walletId: string): Promise<DedicatedAccountRecord | null> {
    const result = await sql<DedicatedAccountRecord>`
      select
        account_number as "accountNumber",
        account_name as "accountName",
        bank_name as "bankName",
        bank_slug as "bankSlug",
        status::text as "status"
      from public.wallet_dedicated_accounts
      where wallet_id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0] ?? null;
  }

  async listLedgerEntries(
    walletId: string,
    pagination: { cursor?: string; limit: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    const cursor = decodeKeysetCursor(pagination.cursor);
    const result = await sql<WalletLedgerEntryRecord>`
      select
        e.id::text as "id",
        e.entry_type::text as "entryType",
        e.amount_kobo as "amountKobo",
        e.balance_after_kobo as "balanceAfterKobo",
        e.order_id::text as "orderId",
        o.order_number as "orderNumber",
        e.provider_reference as "providerReference",
        e.reason,
        e.created_at::text as "createdAt"
      from public.wallet_ledger_entries e
      left join public.orders o on o.id = e.order_id
      where e.wallet_id = ${walletId}::uuid
        and (
          ${cursor?.ts ?? null}::timestamptz is null
          or (e.created_at, e.id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by e.created_at desc, e.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    return toPage(result.rows, pagination.limit, (row) => row.createdAt);
  }

  async listWallets(
    pagination: { cursor?: string; limit: number },
    maxBalanceKobo: number
  ): Promise<WalletPage<AdminWalletRecord>> {
    const cursor = decodeKeysetCursor(pagination.cursor);
    // Over-cap wallets sort first: they are the ones an admin must act on. Within each
    // group the ordering is the standard (created_at, id) desc keyset.
    const result = await sql<AdminWalletRecord>`
      select
        w.id::text as "id",
        w.user_id::text as "userId",
        w.balance_kobo as "balanceKobo",
        w.currency,
        w.status::text as "status",
        w.created_at::text as "createdAt",
        w.updated_at::text as "updatedAt",
        p.email::text as "userEmail",
        p.display_name as "userDisplayName",
        da.account_number as "accountNumber",
        (w.balance_kobo > ${maxBalanceKobo}) as "overCap"
      from public.wallets w
      left join public.profiles p on p.id = w.user_id
      left join public.wallet_dedicated_accounts da on da.wallet_id = w.id
      where (
        ${cursor?.ts ?? null}::timestamptz is null
        or (w.created_at, w.id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
      )
      order by (w.balance_kobo > ${maxBalanceKobo}) desc, w.created_at desc, w.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    return toPage(result.rows, pagination.limit, (row) => row.createdAt);
  }

  async adjustWallet(
    walletId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<WalletRecord> {
    await sql`
      select public.admin_adjust_wallet(
        ${walletId}::uuid,
        ${amountKobo}::integer,
        ${reason},
        ${actorUserId}::uuid
      )
    `.execute(this.database.db);

    return this.requireWallet(walletId);
  }

  async setWalletStatus(walletId: string, status: WalletStatus): Promise<WalletRecord> {
    await sql`
      select public.set_wallet_status(${walletId}::uuid, ${status}::public.wallet_status)
    `.execute(this.database.db);

    return this.requireWallet(walletId);
  }

  async upsertDedicatedAccount(input: DedicatedAccountUpsert): Promise<DedicatedAccountRecord> {
    const result = await sql<DedicatedAccountRecord>`
      insert into public.wallet_dedicated_accounts (
        wallet_id, paystack_customer_code, account_number, account_name,
        bank_name, bank_slug, status, provider_payload
      )
      values (
        ${input.walletId}::uuid,
        ${input.paystackCustomerCode},
        ${input.accountNumber},
        ${input.accountName},
        ${input.bankName},
        ${input.bankSlug},
        ${input.status}::public.dva_status,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (wallet_id) do update
      set paystack_customer_code = excluded.paystack_customer_code,
          account_number = excluded.account_number,
          account_name = excluded.account_name,
          bank_name = excluded.bank_name,
          bank_slug = excluded.bank_slug,
          status = excluded.status,
          provider_payload = excluded.provider_payload,
          updated_at = now()
      returning
        account_number as "accountNumber",
        account_name as "accountName",
        bank_name as "bankName",
        bank_slug as "bankSlug",
        status::text as "status"
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Dedicated account upsert did not return a row.');
    }
    return row;
  }

  async listWalletIdsMissingDedicatedAccount(
    limit: number
  ): Promise<{ walletId: string; userId: string }[]> {
    const result = await sql<{ walletId: string; userId: string }>`
      select w.id::text as "walletId", w.user_id::text as "userId"
      from public.wallets w
      left join public.wallet_dedicated_accounts da on da.wallet_id = w.id
      where da.id is null
      order by w.created_at
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  private async requireWallet(walletId: string): Promise<WalletRecord> {
    const wallet = await this.findWalletById(walletId);
    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} disappeared during the operation.`);
    }
    return wallet;
  }

  private walletSelect() {
    return sql`
      select
        w.id::text as "id",
        w.user_id::text as "userId",
        w.balance_kobo as "balanceKobo",
        w.currency,
        w.status::text as "status",
        w.created_at::text as "createdAt",
        w.updated_at::text as "updatedAt"
      from public.wallets w
    `;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/wallets && git commit -m "feat(wallet): add wallet and platform-settings repositories"
```

---

## Task 9: Customer wallet service

**Files:**

- Create: `src/modules/wallets/wallets.service.ts`
- Test: `test/unit/wallets.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/wallets.service.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvService } from '../../src/config/env.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PlatformSettingsRepository } from '../../src/modules/wallets/platform-settings.repository.js';
import { WalletsService } from '../../src/modules/wallets/wallets.service.js';
import type {
  WalletRecord,
  WalletsRepositoryContract
} from '../../src/modules/wallets/wallets.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'student@example.com',
  role: 'customer'
};

const rider: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'rider'
};

const wallet: WalletRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: customer.userId,
  balanceKobo: 250_000,
  currency: 'NGN',
  status: 'active',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

function createRepository(): WalletsRepositoryContract {
  return {
    ensureWallet: vi.fn().mockResolvedValue(wallet.id),
    findWalletByUserId: vi.fn().mockResolvedValue(wallet),
    findWalletById: vi.fn().mockResolvedValue(wallet),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    listLedgerEntries: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    listWallets: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    adjustWallet: vi.fn().mockResolvedValue(wallet),
    setWalletStatus: vi.fn().mockResolvedValue(wallet),
    upsertDedicatedAccount: vi.fn(),
    listWalletIdsMissingDedicatedAccount: vi.fn().mockResolvedValue([])
  };
}

function createSettings(): PlatformSettingsRepository {
  return {
    findWalletLimits: vi.fn().mockResolvedValue({ minTopupKobo: 50_000, maxBalanceKobo: 5_000_000 })
  } as unknown as PlatformSettingsRepository;
}

function createEnv(dvaEnabled: boolean): EnvService {
  return { get: vi.fn().mockReturnValue(dvaEnabled) } as unknown as EnvService;
}

describe('WalletsService', () => {
  let repository: WalletsRepositoryContract;
  let settings: PlatformSettingsRepository;

  beforeEach(() => {
    repository = createRepository();
    settings = createSettings();
  });

  it('provisions the wallet lazily and returns the balance with limits', async () => {
    const service = new WalletsService(repository, settings, createEnv(false));

    const view = await service.getWallet(customer);

    expect(repository.ensureWallet).toHaveBeenCalledWith(customer.userId);
    expect(view).toEqual({
      balanceKobo: 250_000,
      currency: 'NGN',
      status: 'active',
      minTopupKobo: 50_000,
      maxBalanceKobo: 5_000_000,
      dedicatedAccount: null
    });
  });

  it('refuses non-customer actors', async () => {
    const service = new WalletsService(repository, settings, createEnv(false));

    await expect(service.getWallet(rider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects dedicated-account provisioning while the DVA flag is off', async () => {
    const service = new WalletsService(repository, settings, createEnv(false));

    await expect(service.requestDedicatedAccount(customer)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_FAILED' })
    });
  });

  it('returns the existing account without re-queueing when one is already active', async () => {
    repository.findDedicatedAccount = vi.fn().mockResolvedValue({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank',
      status: 'active'
    });
    const service = new WalletsService(repository, settings, createEnv(true));

    const account = await service.requestDedicatedAccount(customer);

    expect(account.accountNumber).toBe('9900001111');
    // ensureWallet is idempotent and re-emits nothing for an existing wallet.
    expect(repository.ensureWallet).toHaveBeenCalledTimes(1);
  });

  it('caps the ledger page size', async () => {
    const service = new WalletsService(repository, settings, createEnv(false));

    await service.listLedger(customer, { limit: 5000 });

    expect(repository.listLedgerEntries).toHaveBeenCalledWith(wallet.id, { limit: 100 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/wallets.service.spec.ts`
Expected: FAIL — `Cannot find module '../../src/modules/wallets/wallets.service.js'`.

- [ ] **Step 3: Write the service**

Create `src/modules/wallets/wallets.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsRepository } from './wallets.repository.js';
import type {
  CustomerWalletView,
  DedicatedAccountRecord,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletsRepositoryContract
} from './wallets.types.js';

function customerOnly(actor: AuthenticatedActor): void {
  if (actor.role !== 'customer') {
    throw new ForbiddenException({
      code: ErrorCodes.FORBIDDEN,
      message: 'Only customers hold wallets.'
    });
  }
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

@Injectable()
export class WalletsService {
  constructor(
    @Inject(WalletsRepository) private readonly repository: WalletsRepositoryContract,
    @Inject(PlatformSettingsRepository) private readonly settings: PlatformSettingsRepository,
    @Inject(EnvService) private readonly env: EnvService
  ) {}

  /**
   * Reading the wallet provisions it. Signup also calls ensure_customer_wallet, but doing it
   * here too means a customer created before this slice — or one whose signup hook failed —
   * gets a working wallet on first view rather than a 404.
   */
  async getWallet(actor: AuthenticatedActor): Promise<CustomerWalletView> {
    customerOnly(actor);
    const walletId = await this.repository.ensureWallet(actor.userId);
    const [wallet, dedicatedAccount, limits] = await Promise.all([
      this.repository.findWalletById(walletId),
      this.repository.findDedicatedAccount(walletId),
      this.settings.findWalletLimits()
    ]);

    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} was provisioned but could not be read back.`);
    }

    return {
      balanceKobo: wallet.balanceKobo,
      currency: wallet.currency,
      status: wallet.status,
      minTopupKobo: limits.minTopupKobo,
      maxBalanceKobo: limits.maxBalanceKobo,
      dedicatedAccount
    };
  }

  async listLedger(
    actor: AuthenticatedActor,
    pagination: { cursor?: string; limit?: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    customerOnly(actor);
    const walletId = await this.repository.ensureWallet(actor.userId);
    return this.repository.listLedgerEntries(walletId, normalizeCursorPagination(pagination));
  }

  /**
   * Idempotent provision-or-retry for a wallet whose signup-time DVA attempt failed. When an
   * account already exists it is returned as-is; otherwise ensureWallet re-queues nothing (the
   * wallet exists) so we surface a clear "still provisioning" error and let the outbox retry.
   */
  async requestDedicatedAccount(actor: AuthenticatedActor): Promise<DedicatedAccountRecord> {
    customerOnly(actor);

    if (!this.env.get('WALLET_DVA_ENABLED')) {
      throw badRequest(
        'Dedicated account numbers are not available yet. Top up through the payment link instead.'
      );
    }

    const walletId = await this.repository.ensureWallet(actor.userId);
    const existing = await this.repository.findDedicatedAccount(walletId);
    if (existing !== null && existing.status === 'active') {
      return existing;
    }

    throw badRequest('Your dedicated account is still being created. Try again in a few minutes.');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/wallets.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/wallets/wallets.service.ts test/unit/wallets.service.spec.ts && git commit -m "feat(wallet): add customer wallet service with lazy provisioning and DVA gating"
```

---

## Task 10: Admin wallet service

**Files:**

- Create: `src/modules/wallets/admin-wallets.service.ts`
- Test: `test/unit/admin-wallets.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/admin-wallets.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { AdminWalletsService } from '../../src/modules/wallets/admin-wallets.service.js';
import type { PlatformSettingsRepository } from '../../src/modules/wallets/platform-settings.repository.js';
import type {
  WalletRecord,
  WalletsRepositoryContract
} from '../../src/modules/wallets/wallets.types.js';

const admin: AuthenticatedActor = {
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'super_admin'
};

const wallet: WalletRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: '11111111-1111-4111-8111-111111111111',
  balanceKobo: 250_000,
  currency: 'NGN',
  status: 'active',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

function createRepository(): WalletsRepositoryContract {
  return {
    ensureWallet: vi.fn(),
    findWalletByUserId: vi.fn(),
    findWalletById: vi.fn().mockResolvedValue(wallet),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    listLedgerEntries: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    listWallets: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    adjustWallet: vi.fn().mockResolvedValue({ ...wallet, balanceKobo: 350_000 }),
    setWalletStatus: vi.fn().mockResolvedValue({ ...wallet, status: 'frozen' }),
    upsertDedicatedAccount: vi.fn(),
    listWalletIdsMissingDedicatedAccount: vi.fn()
  };
}

function createAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function createSettings(): PlatformSettingsRepository {
  return {
    findWalletLimits: vi
      .fn()
      .mockResolvedValue({ minTopupKobo: 50_000, maxBalanceKobo: 5_000_000 }),
    listSettings: vi.fn().mockResolvedValue([]),
    upsertSetting: vi.fn()
  } as unknown as PlatformSettingsRepository;
}

describe('AdminWalletsService', () => {
  let repository: WalletsRepositoryContract;
  let audit: AuditService;
  let settings: PlatformSettingsRepository;

  beforeEach(() => {
    repository = createRepository();
    audit = createAudit();
    settings = createSettings();
  });

  it('rejects a zero adjustment', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 0, reason: 'typo' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank reason', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 100_000, reason: '   ' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown wallet', async () => {
    repository.findWalletById = vi.fn().mockResolvedValue(undefined);
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 100_000, reason: 'goodwill' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adjusts and audits with before and after balances', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    const updated = await service.adjustWallet(admin, wallet.id, {
      amountKobo: 100_000,
      reason: 'goodwill credit'
    });

    expect(updated.balanceKobo).toBe(350_000);
    expect(repository.adjustWallet).toHaveBeenCalledWith(
      wallet.id,
      100_000,
      'goodwill credit',
      admin.userId
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.adjust',
        entityType: 'wallet',
        entityId: wallet.id,
        before: { balanceKobo: 250_000 },
        after: { balanceKobo: 350_000 }
      })
    );
  });

  it('freezes and audits', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    const updated = await service.setStatus(admin, wallet.id, 'frozen', 'chargeback risk');

    expect(updated.status).toBe('frozen');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.freeze', entityId: wallet.id })
    );
  });

  it('rejects an unknown settings key', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'drop_all_tables', 1)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects a negative settings value', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'wallet_min_topup_kobo', -1)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/admin-wallets.service.spec.ts`
Expected: FAIL — `Cannot find module '../../src/modules/wallets/admin-wallets.service.js'`.

- [ ] **Step 3: Write the service**

Create `src/modules/wallets/admin-wallets.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { WalletStatus } from '../../domain/wallet.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsRepository } from './wallets.repository.js';
import type {
  AdminWalletRecord,
  PlatformSettingRecord,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletRecord,
  WalletsRepositoryContract
} from './wallets.types.js';

// Only these keys may be written through the admin API. Slice B adds the fee-split keys here.
const editableSettingKeys = new Set(['wallet_min_topup_kobo', 'wallet_max_balance_kobo']);

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

@Injectable()
export class AdminWalletsService {
  constructor(
    @Inject(WalletsRepository) private readonly repository: WalletsRepositoryContract,
    @Inject(PlatformSettingsRepository) private readonly settings: PlatformSettingsRepository,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async listWallets(pagination: {
    cursor?: string;
    limit?: number;
  }): Promise<WalletPage<AdminWalletRecord>> {
    const limits = await this.settings.findWalletLimits();
    return this.repository.listWallets(
      normalizeCursorPagination(pagination),
      limits.maxBalanceKobo
    );
  }

  async listLedger(
    walletId: string,
    pagination: { cursor?: string; limit?: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    await this.requireWallet(walletId);
    return this.repository.listLedgerEntries(walletId, normalizeCursorPagination(pagination));
  }

  /**
   * The sensitive route: an administrator creating or destroying balance. It is the only way
   * to write a ledger entry with no provider reference, it requires a reason, it is audited,
   * and the resulting entry is visible in the ledger the customer can read.
   */
  async adjustWallet(
    actor: AuthenticatedActor,
    walletId: string,
    input: { amountKobo: number; reason: string }
  ): Promise<WalletRecord> {
    if (!Number.isInteger(input.amountKobo) || input.amountKobo === 0) {
      throw badRequest('Adjustment amount must be a non-zero whole number of kobo.');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw badRequest('A reason is required for a wallet adjustment.');
    }

    const before = await this.requireWallet(walletId);
    const after = await this.repository.adjustWallet(
      walletId,
      input.amountKobo,
      reason,
      actor.userId
    );

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'wallet.adjust',
      entityType: 'wallet',
      entityId: walletId,
      before: { balanceKobo: before.balanceKobo },
      after: { balanceKobo: after.balanceKobo },
      metadata: { amountKobo: input.amountKobo, reason, customerId: before.userId }
    });

    return after;
  }

  async setStatus(
    actor: AuthenticatedActor,
    walletId: string,
    status: WalletStatus,
    reason?: string
  ): Promise<WalletRecord> {
    const before = await this.requireWallet(walletId);
    const after = await this.repository.setWalletStatus(walletId, status);

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: status === 'frozen' ? 'wallet.freeze' : 'wallet.unfreeze',
      entityType: 'wallet',
      entityId: walletId,
      before: { status: before.status },
      after: { status: after.status },
      metadata: { customerId: before.userId, ...(reason === undefined ? {} : { reason }) }
    });

    return after;
  }

  listSettings(): Promise<PlatformSettingRecord[]> {
    return this.settings.listSettings();
  }

  async updateSetting(
    actor: AuthenticatedActor,
    key: string,
    value: number
  ): Promise<PlatformSettingRecord> {
    if (!editableSettingKeys.has(key)) {
      throw badRequest(
        `Setting "${key}" is not editable. Editable keys: ${[...editableSettingKeys].join(', ')}.`
      );
    }
    if (!Number.isInteger(value) || value < 0) {
      throw badRequest('Setting value must be a non-negative whole number of kobo.');
    }

    const before = await this.settings.listSettings();
    const updated = await this.settings.upsertSetting(key, value, actor.userId);

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'platform_setting.update',
      entityType: 'platform_setting',
      before: { value: before.find((setting) => setting.key === key)?.value ?? null },
      after: { value: updated.value },
      metadata: { key }
    });

    return updated;
  }

  private async requireWallet(walletId: string): Promise<WalletRecord> {
    const wallet = await this.repository.findWalletById(walletId);
    if (wallet === undefined) {
      throw notFound('Wallet was not found.');
    }
    return wallet;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/admin-wallets.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/wallets/admin-wallets.service.ts test/unit/admin-wallets.service.spec.ts && git commit -m "feat(wallet): add admin wallet oversight service with audited adjust, freeze and settings"
```

---

## Task 11: DTOs

**Files:**

- Create: `src/modules/wallets/dto/wallet.dto.ts`, `src/modules/wallets/dto/admin-wallet.dto.ts`

No test — DTOs are declarative; Task 13's integration test exercises the validation.

- [ ] **Step 1: Write the customer DTOs**

Create `src/modules/wallets/dto/wallet.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  dedicatedAccountStatuses,
  walletEntryTypes,
  walletStatuses
} from '../../../domain/wallet.js';

export class DedicatedAccountDto {
  @ApiProperty({ example: '9900001111', type: String })
  accountNumber!: string;

  @ApiProperty({ example: 'MEALDIRECT / ADA LOVELACE', type: String })
  accountName!: string;

  @ApiProperty({ example: 'Wema Bank', type: String })
  bankName!: string;

  @ApiProperty({ example: 'wema-bank', type: String })
  bankSlug!: string;

  @ApiProperty({ enum: dedicatedAccountStatuses, type: String })
  status!: (typeof dedicatedAccountStatuses)[number];
}

export class WalletDto {
  @ApiProperty({ description: 'Spendable balance in kobo.', example: 250000, type: Number })
  balanceKobo!: number;

  @ApiProperty({ example: 'NGN', type: String })
  currency!: string;

  @ApiProperty({ enum: walletStatuses, type: String })
  status!: (typeof walletStatuses)[number];

  @ApiProperty({
    description:
      'Advisory minimum top-up in kobo. UI guidance only — an inbound transfer below this is still credited in full.',
    example: 50000,
    type: Number
  })
  minTopupKobo!: number;

  @ApiProperty({
    description:
      'Advisory maximum balance in kobo. A credit crossing it is still applied and raises an admin flag.',
    example: 5000000,
    type: Number
  })
  maxBalanceKobo!: number;

  @ApiPropertyOptional({
    description:
      'The customer dedicated bank account, or null while WALLET_DVA_ENABLED is off or provisioning is pending.',
    nullable: true,
    type: () => DedicatedAccountDto
  })
  dedicatedAccount!: DedicatedAccountDto | null;
}

export class WalletEnvelopeDto {
  @ApiProperty({ type: () => WalletDto })
  data!: WalletDto;
}

export class DedicatedAccountEnvelopeDto {
  @ApiProperty({ type: () => DedicatedAccountDto })
  data!: DedicatedAccountDto;
}

export class WalletLedgerEntryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: walletEntryTypes, type: String })
  entryType!: (typeof walletEntryTypes)[number];

  @ApiProperty({
    description: 'Signed movement in kobo: credits positive, debits negative.',
    example: -45000,
    type: Number
  })
  amountKobo!: number;

  @ApiProperty({ example: 205000, type: Number })
  balanceAfterKobo!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiPropertyOptional({ example: 'MD-0104', nullable: true, type: String })
  orderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerReference!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;
}

export class WalletLedgerListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => WalletLedgerEntryDto })
  data!: WalletLedgerEntryDto[];

  @ApiProperty({
    example: { hasMore: true, limit: 20, nextCursor: 'eyJ0cyI6IjIwMjYtMDctMjciLCJpZCI6Ii4uLiJ9' },
    type: Object
  })
  pagination!: Record<string, unknown>;
}
```

- [ ] **Step 2: Write the admin DTOs**

Create `src/modules/wallets/dto/admin-wallet.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, MaxLength, MinLength } from 'class-validator';

import { CursorPaginationQueryDto } from '../../../common/dto/api-contract.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

export class WalletIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  walletId!: string;
}

export class AdminWalletListQueryDto extends CursorPaginationQueryDto {}

export class WalletAdjustDto {
  @ApiProperty({
    description:
      'Signed adjustment in kobo. Positive credits the wallet, negative debits it. Must not be zero.',
    example: 100000,
    type: Number
  })
  @Type(() => Number)
  @IsInt()
  amountKobo!: number;

  @ApiProperty({
    description: 'Why the adjustment was made. Mandatory — it appears in the audit log.',
    maxLength: 500,
    minLength: 1,
    type: String
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class WalletFreezeDto {
  @ApiProperty({
    description:
      'True freezes the wallet (no order payments, credits still land). False unfreezes.',
    type: Boolean
  })
  @IsBoolean()
  frozen!: boolean;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsString()
  @MaxLength(500)
  reason?: string;
}

const editableSettingKeys = ['wallet_min_topup_kobo', 'wallet_max_balance_kobo'] as const;

export class PlatformSettingUpdateDto {
  @ApiProperty({ enum: editableSettingKeys, type: String })
  @IsIn(editableSettingKeys)
  key!: (typeof editableSettingKeys)[number];

  @ApiProperty({
    description: 'Non-negative whole number of kobo.',
    example: 5000000,
    type: Number
  })
  @Type(() => Number)
  @IsInt()
  value!: number;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/wallets/dto && git commit -m "feat(wallet): add customer and admin wallet DTOs"
```

---

## Task 12: Controllers and module wiring

**Files:**

- Create: `src/modules/wallets/wallets.controller.ts`, `src/modules/wallets/admin-wallets.controller.ts`, `src/modules/wallets/admin-settings.controller.ts`, `src/modules/wallets/wallets.module.ts`
- Modify: `src/modules/capability-modules.ts`

- [ ] **Step 1: Write the customer controller**

Create `src/modules/wallets/wallets.controller.ts`:

```ts
import { Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { CursorPaginationQueryDto } from '../../common/dto/api-contract.dto.js';
import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  DedicatedAccountEnvelopeDto,
  WalletEnvelopeDto,
  WalletLedgerListEnvelopeDto
} from './dto/wallet.dto.js';
import { WalletsService } from './wallets.service.js';
import type {
  CustomerWalletView,
  DedicatedAccountRecord,
  WalletLedgerEntryRecord
} from './wallets.types.js';

@ApiTags('wallet')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Only customers hold wallets.' })
@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('customer')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Wallet balance, advisory limits and the dedicated account when provisioned.',
    type: WalletEnvelopeDto
  })
  async getWallet(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<CustomerWalletView>> {
    return createSuccessEnvelope(await this.wallets.getWallet(actor));
  }

  @Get('ledger')
  @ApiOkResponse({
    description: 'Keyset-paginated wallet movements, newest first.',
    type: WalletLedgerListEnvelopeDto
  })
  async listLedger(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: CursorPaginationQueryDto
  ): Promise<ListEnvelope<WalletLedgerEntryRecord>> {
    const page = await this.wallets.listLedger(actor, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Post('dedicated-account')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Idempotently provisions or retries the customer dedicated bank account.',
    type: DedicatedAccountEnvelopeDto
  })
  async requestDedicatedAccount(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<DedicatedAccountRecord>> {
    return createSuccessEnvelope(await this.wallets.requestDedicatedAccount(actor));
  }
}
```

- [ ] **Step 2: Write the admin wallets controller**

Create `src/modules/wallets/admin-wallets.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { AdminWalletsService } from './admin-wallets.service.js';
import {
  AdminWalletListQueryDto,
  WalletAdjustDto,
  WalletFreezeDto,
  WalletIdParamDto
} from './dto/admin-wallet.dto.js';
import { WalletLedgerListEnvelopeDto } from './dto/wallet.dto.js';
import type { AdminWalletRecord, WalletLedgerEntryRecord, WalletRecord } from './wallets.types.js';

@ApiTags('admin-wallets')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role and the wallets:manage permission are required.' })
@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminWalletsController {
  constructor(@Inject(AdminWalletsService) private readonly wallets: AdminWalletsService) {}

  @Get()
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Wallets, over-cap balances first.' })
  async listWallets(
    @Query() query: AdminWalletListQueryDto
  ): Promise<ListEnvelope<AdminWalletRecord>> {
    const page = await this.wallets.listWallets({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Get(':walletId/ledger')
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Ledger for one wallet.', type: WalletLedgerListEnvelopeDto })
  async listLedger(
    @Param() params: WalletIdParamDto,
    @Query() query: AdminWalletListQueryDto
  ): Promise<ListEnvelope<WalletLedgerEntryRecord>> {
    const page = await this.wallets.listLedger(params.walletId, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Post(':walletId/adjust')
  @HttpCode(200)
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Signed manual adjustment. Requires a reason and is audited.' })
  async adjustWallet(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: WalletIdParamDto,
    @Body() body: WalletAdjustDto
  ): Promise<SuccessEnvelope<WalletRecord>> {
    return createSuccessEnvelope(
      await this.wallets.adjustWallet(actor, params.walletId, {
        amountKobo: body.amountKobo,
        reason: body.reason
      })
    );
  }

  @Post(':walletId/freeze')
  @HttpCode(200)
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Freezes or unfreezes a wallet.' })
  async freezeWallet(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: WalletIdParamDto,
    @Body() body: WalletFreezeDto
  ): Promise<SuccessEnvelope<WalletRecord>> {
    return createSuccessEnvelope(
      await this.wallets.setStatus(
        actor,
        params.walletId,
        body.frozen ? 'frozen' : 'active',
        body.reason
      )
    );
  }
}
```

- [ ] **Step 3: Write the admin settings controller**

Create `src/modules/wallets/admin-settings.controller.ts`:

```ts
import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { AdminWalletsService } from './admin-wallets.service.js';
import { PlatformSettingUpdateDto } from './dto/admin-wallet.dto.js';
import type { PlatformSettingRecord } from './wallets.types.js';

@ApiTags('admin-settings')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role and the admin:manage permission are required.' })
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminSettingsController {
  constructor(@Inject(AdminWalletsService) private readonly wallets: AdminWalletsService) {}

  @Get()
  @RequirePermission('admin:manage')
  @ApiOkResponse({
    description: 'All platform settings. Wallet limits today, fee splits in slice B.'
  })
  async listSettings(): Promise<ListEnvelope<PlatformSettingRecord>> {
    const settings = await this.wallets.listSettings();
    return createListEnvelope(settings, { hasMore: false, limit: settings.length });
  }

  @Patch()
  @RequirePermission('admin:manage')
  @ApiOkResponse({ description: 'Updates one editable platform setting. Audited.' })
  async updateSetting(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: PlatformSettingUpdateDto
  ): Promise<SuccessEnvelope<PlatformSettingRecord>> {
    return createSuccessEnvelope(await this.wallets.updateSetting(actor, body.key, body.value));
  }
}
```

- [ ] **Step 4: Write the module and register it**

Create `src/modules/wallets/wallets.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminWalletsController } from './admin-wallets.controller.js';
import { AdminWalletsService } from './admin-wallets.service.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsRepository } from './wallets.repository.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WalletsController, AdminWalletsController, AdminSettingsController],
  providers: [
    AuditService,
    PlatformSettingsRepository,
    WalletsRepository,
    WalletsService,
    AdminWalletsService
  ],
  exports: [WalletsRepository, PlatformSettingsRepository]
})
export class WalletsModule {}
```

In `src/modules/capability-modules.ts`, add the import alphabetically with the others and register the module directly after `PaymentsModule`:

```ts
import { WalletsModule } from './wallets/wallets.module.js';
```

```ts
  OrdersModule,
  PaymentsModule,
  WalletsModule,
  PromotionsModule,
```

- [ ] **Step 5: Typecheck and boot the app**

Run: `pnpm typecheck && pnpm vitest run test/integration/health.spec.ts`
Expected: no type errors; the app boots with the new module registered.

- [ ] **Step 6: Commit**

```bash
git add src/modules/wallets src/modules/capability-modules.ts && git commit -m "feat(wallet): expose customer wallet, admin wallet and admin settings HTTP surface"
```

---

## Task 13: Wallet API integration test

**Files:**

- Create: `test/integration/wallets-api.spec.ts`

- [ ] **Step 1: Write the test**

Create `test/integration/wallets-api.spec.ts`. It mirrors the auth/validation shape of `test/integration/orders-api.spec.ts` — these run without a live database, so they assert guard and DTO behaviour, not SQL results.

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string, subject: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      campus_id: '11111111-1111-4111-8111-111111111111'
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('wallet API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a JWT to read the wallet', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/wallet' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses non-customer roles', async () => {
    const token = await signToken('rider', '22222222-2222-4222-8222-222222222222');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an over-large ledger page before touching the database', async () => {
    const token = await signToken('customer', '33333333-3333-4333-8333-333333333333');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wallet/ledger?limit=9999',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(400);
  });

  it('requires an admin JWT for the wallet list', async () => {
    const token = await signToken('customer', '33333333-3333-4333-8333-333333333333');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/wallets',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an adjustment with no reason', async () => {
    const token = await signToken('super_admin', '44444444-4444-4444-8444-444444444444');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/wallets/55555555-5555-4555-8555-555555555555/adjust',
      headers: { authorization: `Bearer ${token}` },
      payload: { amountKobo: 100000 }
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown platform setting key', async () => {
    const token = await signToken('super_admin', '44444444-4444-4444-8444-444444444444');
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'drop_all_tables', value: 1 }
    });
    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/integration/wallets-api.spec.ts`
Expected: PASS (6 tests). If the 403 assertions come back 401, confirm `RolesGuard` is listed after `JwtAuthGuard` in the controller's `@UseGuards`.

- [ ] **Step 3: Commit**

```bash
git add test/integration/wallets-api.spec.ts && git commit -m "test(wallet): cover wallet and admin wallet guards and DTO validation"
```

---

## Task 14: Pay for an order from the wallet

**Files:**

- Modify: `src/modules/orders/dto/create-order.dto.ts`, `src/modules/orders/orders.types.ts`, `src/modules/orders/orders.repository.ts`, `src/modules/orders/orders.service.ts`, `src/modules/orders/orders.module.ts`
- Test: `test/unit/orders.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/orders.service.spec.ts` (reuse the existing fake repository factory in that file; add `createWalletOrder: vi.fn()` to it first):

```ts
describe('wallet checkout', () => {
  it('routes to the wallet RPC when paymentMethod is wallet', async () => {
    const repository = createRepository();
    const service = new OrdersService(repository, createEnv(), createPayments());

    await service.createOrder(
      customer,
      { ...validOrderInput, paymentMethod: 'wallet' },
      'idem-wallet-1'
    );

    expect(repository.createWalletOrder).toHaveBeenCalledTimes(1);
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('keeps the existing pending-payment path as the default', async () => {
    const repository = createRepository();
    const service = new OrdersService(repository, createEnv(), createPayments());

    await service.createOrder(customer, validOrderInput, 'idem-card-1');

    expect(repository.createOrder).toHaveBeenCalledTimes(1);
    expect(repository.createWalletOrder).not.toHaveBeenCalled();
  });

  it('applies the same large-order guard to wallet orders', async () => {
    const repository = createRepository();
    // quoteOrder is stubbed to a total above MAX_ORDER_TOTAL_KOBO in this factory.
    const service = new OrdersService(repository, createEnv(), createPayments());

    await expect(
      service.createOrder(
        customer,
        { ...overCapOrderInput, paymentMethod: 'wallet' },
        'idem-wallet-2'
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createWalletOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/orders.service.spec.ts`
Expected: FAIL — `paymentMethod` is not a property of `CreateOrderDto`.

- [ ] **Step 3: Add `paymentMethod` to the DTO**

In `src/modules/orders/dto/create-order.dto.ts`, add the import and the field. Put the constant next to `deliveryModes`:

```ts
const paymentMethods = ['wallet', 'paystack'] as const;
```

and the property inside `CreateOrderDto`, immediately before `items`:

```ts
  @ApiPropertyOptional({
    description:
      "Funding source. 'wallet' debits the balance and creates the order already paid; 'paystack' (the default) creates a pending-payment order and returns a checkout link. A wallet order with too little balance is rejected with 402 WALLET_INSUFFICIENT_BALANCE.",
    enum: paymentMethods,
    type: String
  })
  @IsOptional()
  @IsIn(paymentMethods)
  paymentMethod?: (typeof paymentMethods)[number];
```

- [ ] **Step 4: Extend the repository contract and implementation**

In `src/modules/orders/orders.types.ts`, add `createWalletOrder` to `OrdersRepositoryContract` with the identical signature to `createOrder`:

```ts
  createWalletOrder(
    customerId: string,
    input: CreateOrderDto,
    idempotencyKey: string,
    requestHash: string,
    serviceFeeKobo: number,
    maxOrderTotalKobo: number,
    largeOrderSurcharge: LargeOrderSurchargeConfig
  ): Promise<CreatedOrder>;
```

In `src/modules/orders/orders.repository.ts`, add the method next to `createOrder`. It is `createOrder` with a different function name — the wallet RPC takes the same 17 positional arguments:

```ts
  async createWalletOrder(
    customerId: string,
    input: CreateOrderDto,
    idempotencyKey: string,
    requestHash: string,
    serviceFeeKobo: number,
    maxOrderTotalKobo: number,
    largeOrderSurcharge: LargeOrderSurchargeConfig
  ): Promise<CreatedOrder> {
    const items = input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      customization: item.customization ?? {},
      soup_option_id: item.soupOptionId ?? null
    }));

    return this.database.db.transaction().execute(async (trx) => {
      const result = await sql<CreateOrderResult>`
        select public.create_paid_order_from_wallet(
          ${customerId}::uuid,
          ${input.campusId}::uuid,
          ${input.vendorId}::uuid,
          ${input.serviceDate}::date,
          ${input.deliverySlotId}::uuid,
          ${input.locationId}::uuid,
          ${input.deliveryMode ?? null}::public.delivery_mode,
          ${JSON.stringify(items)}::jsonb,
          ${idempotencyKey},
          ${requestHash},
          ${input.promotionCode ?? null},
          ${input.specialInstructions ?? null},
          ${serviceFeeKobo}::integer,
          ${maxOrderTotalKobo}::integer,
          ${largeOrderSurcharge.surchargeBps}::integer,
          ${largeOrderSurcharge.surchargeFlatKobo}::integer,
          ${largeOrderSurcharge.accepted}::boolean
        ) as order_id
      `.execute(trx);

      const orderId = result.rows[0]?.order_id;
      if (orderId === undefined) {
        throw new Error('Wallet order creation did not return an order ID.');
      }

      const deliveryCode = await this.ensureOrderDeliveryMetadata(
        orderId,
        normalizeRoomNumber(input.roomNumber),
        trx
      );

      return { orderId, deliveryHandoff: buildDeliveryHandoff(deliveryCode) };
    });
  }
```

- [ ] **Step 5: Branch in the service**

In `src/modules/orders/orders.service.ts`, replace the `return this.repository.createOrder(...)` tail of `createOrder` with:

```ts
const surcharge = {
  surchargeBps: this.env.get('LARGE_ORDER_SURCHARGE_BPS'),
  surchargeFlatKobo: this.env.get('LARGE_ORDER_SURCHARGE_FLAT_KOBO'),
  accepted
};

// Wallet orders are created already paid inside one transaction — no pending_payment,
// no reservation timer, no webhook. Everything before this point (quote, room number,
// large-order guard) is identical for both funding sources.
if (input.paymentMethod === 'wallet') {
  return this.repository.createWalletOrder(
    actor.userId,
    input,
    idempotencyKey,
    hashOrderRequest(input),
    serviceFeeKobo,
    maxOrderTotalKobo,
    surcharge
  );
}

return this.repository.createOrder(
  actor.userId,
  input,
  idempotencyKey,
  hashOrderRequest(input),
  serviceFeeKobo,
  maxOrderTotalKobo,
  surcharge
);
```

- [ ] **Step 6: Document the 402 on the endpoint**

In `src/modules/orders/orders.controller.ts`, add the import and the decorator on `createOrder`:

```ts
import { ApiResponse } from '@nestjs/swagger';
```

```ts
  @ApiResponse({
    status: 402,
    description:
      'Wallet balance is short of the order total. The body carries details.shortfallKobo; the order is not created and no inventory is held.'
  })
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/orders.service.spec.ts test/integration/orders-api.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/orders test/unit/orders.service.spec.ts && git commit -m "feat(orders): accept paymentMethod and route wallet orders to the atomic paid-order RPC"
```

---

## Task 15: Route `dedicated_nuban` charges to the wallet

The critical ordering the spec calls out: a top-up has no order, so if it fell through to the existing order-reference lookup every top-up would file a spurious `provider_success_not_local` issue. Branching in `mapPaystackEvent` puts the decision before that lookup by construction.

**Files:**

- Modify: `src/domain/payments.ts`, `src/modules/payments/paystack-webhook.service.ts`
- Test: `test/unit/paystack-event-mapping.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/paystack-event-mapping.spec.ts`:

```ts
describe('dedicated virtual account top-ups', () => {
  it('maps a dedicated_nuban charge.success to a wallet top-up', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        id: 987654,
        reference: 'PSTK-TRF-9001',
        amount: 1000000,
        currency: 'NGN',
        authorization: {
          channel: 'dedicated_nuban',
          receiver_bank_account_number: '9900001111',
          sender_name: 'ADA LOVELACE'
        }
      }
    });

    expect(event).toEqual({
      type: 'WALLET_TOPUP_SUCCEEDED',
      providerReference: 'PSTK-TRF-9001',
      amountKobo: 1000000,
      accountNumber: '9900001111',
      senderName: 'ADA LOVELACE',
      currency: 'NGN'
    });
  });

  it('still maps an ordinary card charge.success to a payment', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'MD-0104',
        amount: 45000,
        currency: 'NGN',
        authorization: { channel: 'card' }
      }
    });

    expect(event.type).toBe('PAYMENT_SUCCEEDED');
  });

  it('reads the account number from the data root when Paystack puts it there', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'PSTK-TRF-9002',
        amount: 500000,
        authorization: { channel: 'dedicated_nuban' },
        receiver_bank_account_number: '9900002222'
      }
    });

    expect(event).toMatchObject({
      type: 'WALLET_TOPUP_SUCCEEDED',
      accountNumber: '9900002222'
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/paystack-event-mapping.spec.ts`
Expected: FAIL — the dedicated_nuban charge maps to `PAYMENT_SUCCEEDED`.

- [ ] **Step 3: Extend the domain mapping**

In `src/domain/payments.ts`, widen the payload type:

```ts
export type PaystackWebhookEvent = {
  event: string;
  data?: {
    id?: string | number;
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    receiver_bank_account_number?: string;
    authorization?: {
      channel?: string;
      receiver_bank_account_number?: string;
      sender_name?: string;
    };
  };
};
```

Add the event variant to `PaymentDomainEvent`, before `IGNORED`:

```ts
  | {
      type: 'WALLET_TOPUP_SUCCEEDED';
      providerReference: string;
      amountKobo: number;
      accountNumber?: string;
      senderName?: string;
      currency?: string;
    }
```

And branch inside `mapPaystackEvent`, **above** the existing `charge.success` block:

```ts
// Money landing on a customer dedicated virtual account. This must be decided before the
// ordinary charge.success branch: a top-up has no order, so the order-reference lookup
// downstream would file a spurious provider_success_not_local issue for every top-up.
if (input.event === 'charge.success' && input.data?.authorization?.channel === 'dedicated_nuban') {
  const accountNumber =
    input.data.authorization.receiver_bank_account_number ??
    input.data.receiver_bank_account_number;
  const senderName = input.data.authorization.sender_name;
  return {
    type: 'WALLET_TOPUP_SUCCEEDED',
    providerReference: reference,
    amountKobo: input.data.amount ?? 0,
    ...(accountNumber === undefined ? {} : { accountNumber }),
    ...(senderName === undefined ? {} : { senderName }),
    ...(input.data.currency === undefined ? {} : { currency: input.data.currency })
  };
}
```

- [ ] **Step 4: Handle the event in the webhook service**

In `src/modules/payments/paystack-webhook.service.ts`, inside `runWebhookTransaction`, add the branch alongside the existing two:

```ts
if (event.type === 'WALLET_TOPUP_SUCCEEDED') {
  await this.creditWalletTopup(trx, payload, event);
}
```

And add the method next to `applyVerifiedPayment`:

```ts
  /**
   * Credit an inbound transfer to the wallet behind the receiving account number. Crediting is
   * idempotent on the Paystack reference inside credit_wallet_topup, so a redelivered webhook
   * is a no-op. A transfer we cannot attribute to any wallet is money we hold with nowhere to
   * put it, so it is filed as a critical issue rather than silently dropped.
   */
  private async creditWalletTopup(
    trx: Kysely<DatabaseSchema>,
    payload: PaystackWebhookEvent,
    event: Extract<
      Exclude<ReturnType<typeof mapPaystackEvent>, { type: 'IGNORED' }>,
      { type: 'WALLET_TOPUP_SUCCEEDED' }
    >
  ): Promise<void> {
    if (event.accountNumber === undefined) {
      await this.recordIssue(
        trx,
        `wallet_topup_unattributable:${event.providerReference}`,
        'provider_success_not_local',
        'critical',
        null,
        null,
        event.providerReference,
        { reason: 'dedicated_nuban charge carried no receiver account number' }
      );
      return;
    }

    const credited = await sql<{ entryId: string | null }>`
      select public.credit_wallet_topup(
        ${event.providerReference},
        ${event.accountNumber},
        null::uuid,
        ${event.amountKobo}::integer,
        ${event.senderName ?? null},
        ${JSON.stringify(payload)}::jsonb
      )::text as "entryId"
    `.execute(trx);

    // A null entry id means the reference was already credited — an ordinary redelivery.
    void credited;
  }
```

`credit_wallet_topup` raises `P0002` when no wallet matches the account number. That aborts the webhook transaction, which is correct: `processWithDatabase` already catches, records `webhook_processing_failed`, and rethrows so Paystack retries.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/paystack-event-mapping.spec.ts test/integration/paystack-webhook.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/payments.ts src/modules/payments/paystack-webhook.service.ts test/unit/paystack-event-mapping.spec.ts && git commit -m "feat(wallet): credit dedicated_nuban charges to the wallet before the order lookup"
```

---

## Task 16: Paystack DVA client methods

**Files:**

- Modify: `src/modules/payments/paystack.client.ts`, `src/modules/payments/payments.types.ts`
- Test: `test/unit/paystack-dedicated-account.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/paystack-dedicated-account.spec.ts`:

```ts
import { BadGatewayException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvService } from '../../src/config/env.service.js';
import { PaystackClient } from '../../src/modules/payments/paystack.client.js';

function createEnv(): EnvService {
  const values: Record<string, unknown> = {
    PAYSTACK_BASE_URL: 'https://api.paystack.co',
    PAYSTACK_SECRET_KEY: 'sk_test_xxx',
    APP_URL_CUSTOMER: 'https://user.mealdirectly.com',
    WALLET_DVA_PROVIDER: 'test-bank'
  };
  return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

describe('PaystackClient dedicated accounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a customer and returns its code', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { customer_code: 'CUS_abc123' } }), {
        status: 200
      })
    );

    const client = new PaystackClient(createEnv());
    const result = await client.createCustomer({
      email: 'student@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });

    expect(result.customerCode).toBe('CUS_abc123');
  });

  it('creates a dedicated account and returns the bank details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            account_number: '9900001111',
            account_name: 'MEALDIRECT / ADA LOVELACE',
            bank: { name: 'Wema Bank', slug: 'wema-bank' }
          }
        }),
        { status: 200 }
      )
    );

    const client = new PaystackClient(createEnv());
    const result = await client.createDedicatedAccount({ customerCode: 'CUS_abc123' });

    expect(result).toMatchObject({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank'
    });
  });

  it('rejects a dedicated-account response missing the account number', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { bank: { name: 'Wema Bank' } } }), {
        status: 200
      })
    );

    const client = new PaystackClient(createEnv());
    await expect(
      client.createDedicatedAccount({ customerCode: 'CUS_abc123' })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/paystack-dedicated-account.spec.ts`
Expected: FAIL — `client.createCustomer is not a function`.

- [ ] **Step 3: Add the types**

In `src/modules/payments/payments.types.ts`, add:

```ts
export type PaystackCustomerInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type PaystackCustomerResult = {
  customerCode: string;
  providerPayload: Record<string, unknown>;
};

export type PaystackDedicatedAccountInput = {
  customerCode: string;
  preferredBank?: string;
};

export type PaystackDedicatedAccountResult = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  providerPayload: Record<string, unknown>;
};
```

and add both methods to `PaystackClientContract`:

```ts
  createCustomer(input: PaystackCustomerInput): Promise<PaystackCustomerResult>;
  createDedicatedAccount(
    input: PaystackDedicatedAccountInput
  ): Promise<PaystackDedicatedAccountResult>;
```

- [ ] **Step 4: Implement them**

In `src/modules/payments/paystack.client.ts`, add the two methods (and the imports for the four new types):

```ts
  async createCustomer(input: PaystackCustomerInput): Promise<PaystackCustomerResult> {
    const envelope = await this.request('/customer', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        ...(input.firstName === undefined ? {} : { first_name: input.firstName }),
        ...(input.lastName === undefined ? {} : { last_name: input.lastName }),
        ...(input.phone === undefined ? {} : { phone: input.phone })
      })
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack customer creation returned an invalid response.');
    }

    const customerCode = stringFrom(envelope.data.customer_code);
    if (customerCode === undefined) {
      throw badGateway('Paystack customer creation response was missing the customer code.');
    }

    return { customerCode, providerPayload: this.providerPayload(envelope) };
  }

  async createDedicatedAccount(
    input: PaystackDedicatedAccountInput
  ): Promise<PaystackDedicatedAccountResult> {
    const preferredBank = input.preferredBank ?? this.env.get('WALLET_DVA_PROVIDER');
    const envelope = await this.request('/dedicated_account', {
      method: 'POST',
      body: JSON.stringify({ customer: input.customerCode, preferred_bank: preferredBank })
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack dedicated account creation returned an invalid response.');
    }

    const bank = isRecord(envelope.data.bank) ? envelope.data.bank : {};
    const accountNumber = stringFrom(envelope.data.account_number);
    const accountName = stringFrom(envelope.data.account_name);
    const bankName = stringFrom(bank.name);
    const bankSlug = stringFrom(bank.slug);

    if (
      accountNumber === undefined ||
      accountName === undefined ||
      bankName === undefined ||
      bankSlug === undefined
    ) {
      throw badGateway('Paystack dedicated account response was missing bank details.');
    }

    return {
      accountNumber,
      accountName,
      bankName,
      bankSlug,
      providerPayload: this.providerPayload(envelope)
    };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/paystack-dedicated-account.spec.ts test/unit/paystack-transfers.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/payments/paystack.client.ts src/modules/payments/payments.types.ts test/unit/paystack-dedicated-account.spec.ts && git commit -m "feat(payments): add Paystack create-customer and create-dedicated-account client methods"
```

---

## Task 17: DVA provisioning outbox handler

**Files:**

- Create: `src/worker/handlers/wallet-dva.handler.ts`, `src/worker/handlers/wallet-reads.repository.ts`
- Modify: `src/worker/worker.module.ts`
- Test: `test/unit/wallet-dva.handler.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/wallet-dva.handler.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { OutboxEvent } from '../../src/worker/outbox.repository.js';
import { WalletDvaHandler } from '../../src/worker/handlers/wallet-dva.handler.js';

const event: OutboxEvent = {
  id: 'e1',
  eventType: 'wallet.dva_requested',
  aggregateType: 'wallet',
  aggregateId: '33333333-3333-4333-8333-333333333333',
  payload: { wallet_id: '33333333-3333-4333-8333-333333333333', user_id: 'u1' },
  attempts: 0
};

function createReads() {
  return {
    findWalletOwner: vi.fn().mockResolvedValue({
      walletId: event.aggregateId,
      userId: 'u1',
      email: 'student@example.com',
      displayName: 'Ada Lovelace'
    }),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    upsertDedicatedAccount: vi.fn().mockResolvedValue(undefined)
  };
}

function createPaystack() {
  return {
    createCustomer: vi.fn().mockResolvedValue({ customerCode: 'CUS_abc', providerPayload: {} }),
    createDedicatedAccount: vi.fn().mockResolvedValue({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank',
      providerPayload: {}
    })
  };
}

describe('WalletDvaHandler', () => {
  it('does nothing while the DVA flag is off', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, false);

    await handler.handle(event);

    expect(paystack.createCustomer).not.toHaveBeenCalled();
    expect(reads.upsertDedicatedAccount).not.toHaveBeenCalled();
  });

  it('provisions a customer then an account and stores the result as active', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, true);

    await handler.handle(event);

    expect(paystack.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'student@example.com' })
    );
    expect(paystack.createDedicatedAccount).toHaveBeenCalledWith({ customerCode: 'CUS_abc' });
    expect(reads.upsertDedicatedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountNumber: '9900001111', status: 'active' })
    );
  });

  it('skips a wallet that already has an active account', async () => {
    const reads = createReads();
    reads.findDedicatedAccount = vi.fn().mockResolvedValue({ status: 'active' });
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, true);

    await handler.handle(event);

    expect(paystack.createCustomer).not.toHaveBeenCalled();
  });

  it('records a failed status and rethrows so the outbox retries', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    paystack.createDedicatedAccount = vi.fn().mockRejectedValue(new Error('paystack 503'));
    const handler = new WalletDvaHandler(reads, paystack, true);

    await expect(handler.handle(event)).rejects.toThrow('paystack 503');
    expect(reads.upsertDedicatedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/wallet-dva.handler.spec.ts`
Expected: FAIL — `Cannot find module '../../src/worker/handlers/wallet-dva.handler.js'`.

- [ ] **Step 3: Write the reads repository**

Create `src/worker/handlers/wallet-reads.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { DedicatedAccountStatus } from '../../domain/wallet.js';

export type WalletOwner = {
  walletId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
};

export type DedicatedAccountWrite = {
  walletId: string;
  paystackCustomerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
  providerPayload: Record<string, unknown>;
};

@Injectable()
export class WalletReadsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findWalletOwner(walletId: string): Promise<WalletOwner | undefined> {
    const result = await sql<WalletOwner>`
      select
        w.id::text as "walletId",
        w.user_id::text as "userId",
        p.email::text as "email",
        p.display_name as "displayName"
      from public.wallets w
      left join public.profiles p on p.id = w.user_id
      where w.id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findDedicatedAccount(walletId: string): Promise<{ status: DedicatedAccountStatus } | null> {
    const result = await sql<{ status: DedicatedAccountStatus }>`
      select status::text as "status"
      from public.wallet_dedicated_accounts
      where wallet_id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0] ?? null;
  }

  async upsertDedicatedAccount(input: DedicatedAccountWrite): Promise<void> {
    await sql`
      insert into public.wallet_dedicated_accounts (
        wallet_id, paystack_customer_code, account_number, account_name,
        bank_name, bank_slug, status, provider_payload
      )
      values (
        ${input.walletId}::uuid,
        ${input.paystackCustomerCode},
        ${input.accountNumber},
        ${input.accountName},
        ${input.bankName},
        ${input.bankSlug},
        ${input.status}::public.dva_status,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (wallet_id) do update
      set paystack_customer_code = excluded.paystack_customer_code,
          account_number = excluded.account_number,
          account_name = excluded.account_name,
          bank_name = excluded.bank_name,
          bank_slug = excluded.bank_slug,
          status = excluded.status,
          provider_payload = excluded.provider_payload,
          updated_at = now()
    `.execute(this.database.db);
  }
}
```

- [ ] **Step 4: Write the handler**

Create `src/worker/handlers/wallet-dva.handler.ts`:

```ts
import type {
  PaystackCustomerInput,
  PaystackCustomerResult,
  PaystackDedicatedAccountInput,
  PaystackDedicatedAccountResult
} from '../../modules/payments/payments.types.js';
import type { OutboxEvent } from '../outbox.repository.js';
import type { DedicatedAccountWrite, WalletOwner } from './wallet-reads.repository.js';

export type WalletReads = {
  findWalletOwner: (walletId: string) => Promise<WalletOwner | undefined>;
  findDedicatedAccount: (walletId: string) => Promise<{ status: string } | null>;
  upsertDedicatedAccount: (input: DedicatedAccountWrite) => Promise<void>;
};

export type DedicatedAccountProvisioner = {
  createCustomer: (input: PaystackCustomerInput) => Promise<PaystackCustomerResult>;
  createDedicatedAccount: (
    input: PaystackDedicatedAccountInput
  ) => Promise<PaystackDedicatedAccountResult>;
};

function splitDisplayName(displayName: string | null): { firstName?: string; lastName?: string } {
  const parts = (displayName ?? '')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return {};
  const [firstName, ...rest] = parts;
  return {
    ...(firstName === undefined ? {} : { firstName }),
    ...(rest.length === 0 ? {} : { lastName: rest.join(' ') })
  };
}

/**
 * Drains `wallet.dva_requested`: creates the Paystack customer, then its dedicated virtual
 * account, and stores the bank details on the wallet. Entirely inert while WALLET_DVA_ENABLED
 * is off — the flag is the switch we flip once Paystack approves DVA on the account, and until
 * then wallets simply have no account number and top-ups run through a checkout link.
 *
 * Failures write a `failed` row and rethrow, so the outbox retries with backoff and an admin
 * (or the customer, via POST /wallet/dedicated-account) can see the state.
 */
export class WalletDvaHandler {
  constructor(
    private readonly reads: WalletReads,
    private readonly paystack: DedicatedAccountProvisioner,
    private readonly enabled: boolean
  ) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    if (!this.enabled) {
      return;
    }

    const walletId = event.aggregateId;
    const existing = await this.reads.findDedicatedAccount(walletId);
    if (existing !== null && existing.status === 'active') {
      return;
    }

    const owner = await this.reads.findWalletOwner(walletId);
    if (owner === undefined || owner.email === null) {
      // No owner or no email: nothing Paystack can be told. Completing the event is correct —
      // retrying cannot change the outcome, and POST /wallet/dedicated-account can retry later.
      return;
    }

    let customer: PaystackCustomerResult | undefined;
    try {
      customer = await this.paystack.createCustomer({
        email: owner.email,
        ...splitDisplayName(owner.displayName)
      });

      const account = await this.paystack.createDedicatedAccount({
        customerCode: customer.customerCode
      });

      await this.reads.upsertDedicatedAccount({
        walletId,
        paystackCustomerCode: customer.customerCode,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName: account.bankName,
        bankSlug: account.bankSlug,
        status: 'active',
        providerPayload: account.providerPayload
      });
    } catch (error) {
      await this.reads.upsertDedicatedAccount({
        walletId,
        paystackCustomerCode: customer?.customerCode ?? '',
        accountNumber: `pending:${walletId}`,
        accountName: 'pending',
        bankName: 'pending',
        bankSlug: 'pending',
        status: 'failed',
        providerPayload: {
          error: error instanceof Error ? error.message : 'unknown provisioning error'
        }
      });
      throw error;
    }
  };
}
```

The `pending:` placeholder account number keeps the `account_number` unique index satisfied for a failed row while remaining obviously non-real; a later successful run overwrites it.

- [ ] **Step 5: Wire the handler into the worker**

In `src/worker/worker.module.ts`, add the imports:

```ts
import { PaystackClient } from '../modules/payments/paystack.client.js';
import { WalletDvaHandler } from './handlers/wallet-dva.handler.js';
import { WalletReadsRepository } from './handlers/wallet-reads.repository.js';
```

Add `WalletReadsRepository` and `PaystackClient` to `providers`, then the handler factory:

```ts
    {
      provide: WalletDvaHandler,
      useFactory: (
        reads: WalletReadsRepository,
        paystack: PaystackClient,
        env: EnvService
      ): WalletDvaHandler => new WalletDvaHandler(reads, paystack, env.get('WALLET_DVA_ENABLED')),
      inject: [WalletReadsRepository, PaystackClient, EnvService]
    },
```

And register it in the `HandlerRegistry` factory — add `walletDva: WalletDvaHandler` to its parameters and `WalletDvaHandler` to its `inject` array, then:

```ts
registry.register('wallet.dva_requested', walletDva.handle);
```

Do **not** add a `'wallet.'` entry to `NOTIFICATION_EVENT_PREFIXES`: `wallet.dva_requested` materializes no notification row, so the dispatch handler would find nothing to send.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/wallet-dva.handler.spec.ts test/integration/worker-outbox.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker test/unit/wallet-dva.handler.spec.ts && git commit -m "feat(wallet): provision Paystack dedicated accounts from the outbox behind WALLET_DVA_ENABLED"
```

---

## Task 18: Refund to wallet by default

`PaymentsService.initiateRefund` today always calls Paystack. After this task the default destination is the wallet — instant, no Paystack refund fee, no 3–10 day wait — and the card path stays reachable for disputes and chargeback handling by passing `destination: 'paystack'`.

**Files:**

- Modify: `src/modules/payments/payments.service.ts`, `src/modules/payments/payments.types.ts`, `src/modules/payments/payments.repository.ts`, `src/modules/payments/dto/refund-admin.dto.ts`, `src/modules/payments/payments.module.ts`
- Test: `test/unit/payments.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/payments.service.spec.ts` (the file's existing `createRepository` / `createPaystack` factories are reused; add `creditRefundToWallet: vi.fn().mockResolvedValue('ledger-1')` to the repository factory first):

```ts
describe('refund destination', () => {
  it('credits the wallet by default and does not call Paystack', async () => {
    const repository = createRepository();
    const paystack = createPaystack();
    const service = new PaymentsService(repository, paystack, createAudit(), createNotes());

    await service.initiateRefund(superAdmin, payment.id, {
      amountKobo: 45000,
      reasonCode: 'customer_request'
    });

    expect(repository.creditRefundToWallet).toHaveBeenCalledWith(
      payment.orderId,
      45000,
      expect.any(String),
      superAdmin.userId
    );
    expect(paystack.createRefund).not.toHaveBeenCalled();
  });

  it('uses Paystack when the admin explicitly asks for a card refund', async () => {
    const repository = createRepository();
    const paystack = createPaystack();
    const service = new PaymentsService(repository, paystack, createAudit(), createNotes());

    await service.initiateRefund(superAdmin, payment.id, {
      amountKobo: 45000,
      reasonCode: 'chargeback_defence',
      destination: 'paystack'
    });

    expect(paystack.createRefund).toHaveBeenCalledTimes(1);
    expect(repository.creditRefundToWallet).not.toHaveBeenCalled();
  });

  it('still refuses to refund more than the refundable balance', async () => {
    const repository = createRepository();
    const service = new PaymentsService(repository, createPaystack(), createAudit(), createNotes());

    await expect(
      service.initiateRefund(superAdmin, payment.id, {
        amountKobo: 99_999_999,
        reasonCode: 'customer_request'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/payments.service.spec.ts`
Expected: FAIL — `destination` is not a property of `RefundInput`.

- [ ] **Step 3: Extend the types**

In `src/modules/payments/payments.types.ts`, add `destination` to `RefundInput`:

```ts
export type RefundDestination = 'wallet' | 'paystack';
```

and inside `RefundInput`:

```ts
  destination?: RefundDestination;
```

Add to `PaymentsRepositoryContract`:

```ts
  creditRefundToWallet(
    orderId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<string>;
```

- [ ] **Step 4: Implement the repository method**

In `src/modules/payments/payments.repository.ts`, add:

```ts
  async creditRefundToWallet(
    orderId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<string> {
    const result = await sql<{ entryId: string }>`
      select public.refund_order_to_wallet(
        ${orderId}::uuid,
        ${amountKobo}::integer,
        ${reason},
        ${actorUserId}::uuid
      )::text as "entryId"
    `.execute(this.database.db);

    const entryId = result.rows[0]?.entryId;
    if (entryId === undefined) {
      throw new Error('Wallet refund did not return a ledger entry ID.');
    }
    return entryId;
  }
```

- [ ] **Step 5: Branch in the service**

In `src/modules/payments/payments.service.ts`, replace the tail of `initiateRefund` (everything from `const refund = await this.repository.createRefundRequest(...)` onwards):

```ts
const refund = await this.repository.createRefundRequest(payment.id, input, actor.userId);

// Wallet is the default destination: instant, no Paystack refund fee, no 3–10 day wait.
// The card path stays reachable for disputes and chargeback handling.
if ((input.destination ?? 'wallet') === 'wallet') {
  const ledgerEntryId = await this.repository.creditRefundToWallet(
    payment.orderId,
    input.amountKobo,
    input.reasonText ?? input.reasonCode,
    actor.userId
  );

  return this.repository.updateRefundProviderPayload(
    refund.id,
    ledgerEntryId,
    { destination: 'wallet', walletLedgerEntryId: ledgerEntryId },
    'succeeded'
  );
}

const providerRefund = await this.paystack.createRefund({
  amountKobo: input.amountKobo,
  transaction: payment.providerTransactionId ?? payment.providerReference,
  ...(input.reasonText === undefined ? {} : { reasonText: input.reasonText })
});

return this.repository.updateRefundProviderPayload(
  refund.id,
  providerRefund.id.toString(),
  providerRefund.providerPayload,
  this.mapRefundStatus(providerRefund.status)
);
```

- [ ] **Step 6: Expose the choice on the DTO**

In `src/modules/payments/dto/refund-admin.dto.ts`, add to `RefundInitiateDto` (and to whichever DTO carries the refund request body — mirror the existing `amountKobo` field's decorators):

```ts
  @ApiPropertyOptional({
    default: 'wallet',
    description:
      "Where the money goes. 'wallet' (default) credits the customer balance instantly. 'paystack' issues a real card refund — use for disputes and chargeback defence.",
    enum: ['wallet', 'paystack'],
    type: String
  })
  @IsOptional()
  @IsIn(['wallet', 'paystack'])
  destination?: 'wallet' | 'paystack';
```

- [ ] **Step 7: Give PaymentsModule access to the wallet SQL**

The repository method calls a database function directly, so no new provider is needed. Confirm `PaymentsModule` still compiles unchanged.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/payments.service.spec.ts test/integration/payments-api.spec.ts test/integration/finance-admin-api.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/payments test/unit/payments.service.spec.ts && git commit -m "feat(payments): refund to wallet by default, keeping the card refund path for disputes"
```

---

## Task 19: Nightly balance-drift reconciliation

**Files:**

- Modify: `src/modules/payments/reconciliation.repository.ts`, `src/modules/payments/reconciliation.service.ts`, `src/modules/payments/reconciliation.types.ts`, `src/cron.ts`, `render.yaml`
- Test: `test/unit/reconciliation.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/reconciliation.service.spec.ts` (or append if it exists):

```ts
import { describe, expect, it, vi } from 'vitest';

import type { PaymentsService } from '../../src/modules/payments/payments.service.js';
import type { ReconciliationRepository } from '../../src/modules/payments/reconciliation.repository.js';
import { ReconciliationService } from '../../src/modules/payments/reconciliation.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';

const superAdmin: AuthenticatedActor = {
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'super_admin'
};

describe('ReconciliationService.scan', () => {
  it('adds wallet balance drift to the detected count', async () => {
    const repository = {
      scan: vi.fn().mockResolvedValue(2),
      detectWalletBalanceDrift: vi.fn().mockResolvedValue(3)
    } as unknown as ReconciliationRepository;

    const service = new ReconciliationService(repository, {} as PaymentsService);

    await expect(service.scan(superAdmin)).resolves.toEqual({ detected: 5 });
    expect(repository.detectWalletBalanceDrift).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/reconciliation.service.spec.ts`
Expected: FAIL — `repository.detectWalletBalanceDrift is not a function`.

- [ ] **Step 3: Add the repository method**

In `src/modules/payments/reconciliation.repository.ts`, add:

```ts
  async detectWalletBalanceDrift(): Promise<number> {
    const result = await sql<{ detected: number }>`
      select public.detect_wallet_balance_drift() as "detected"
    `.execute(this.database.db);

    return result.rows[0]?.detected ?? 0;
  }
```

- [ ] **Step 4: Fold it into the scan**

In `src/modules/payments/reconciliation.service.ts`, replace `scan`:

```ts
  async scan(actor: AuthenticatedActor): Promise<{ detected: number }> {
    this.assertAdmin(actor);
    // Two independent invariants: the Paystack-vs-local payment sweep, and the wallet
    // cache-vs-ledger assertion. Both file rows into payment_reconciliation_issues.
    const [payments, walletDrift] = await Promise.all([
      this.repository.scan(900, 3600),
      this.repository.detectWalletBalanceDrift()
    ]);
    return { detected: payments + walletDrift };
  }
```

- [ ] **Step 5: Add the issue types to the TypeScript union**

In `src/modules/payments/reconciliation.types.ts`, extend `ReconciliationIssueType`:

```ts
export type ReconciliationIssueType =
  | 'initialized_unconfirmed'
  | 'paid_order_pending'
  | 'webhook_processing_failed'
  | 'provider_success_not_local'
  | 'duplicate_success'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'refund_stuck'
  | 'wallet_balance_drift'
  | 'wallet_balance_cap_exceeded';
```

- [ ] **Step 6: Add a cron job**

In `src/cron.ts`, add `'reconcile-wallet-balances'` to `cronJobs` and the branch inside `runCronJob`:

```ts
if (job === 'reconcile-wallet-balances') {
  const result = await sql<{ detected: number }>`
        select public.detect_wallet_balance_drift() as "detected"
      `.execute(database.db);
  logger.log(
    { message: 'Reconciled wallet balances', job, detected: result.rows[0]?.detected ?? 0 },
    'Cron'
  );
}
```

- [ ] **Step 7: Schedule it**

In `render.yaml`, add a cron service copying the shape of the existing `reconcile-pending-payments` entry, running nightly:

```yaml
- type: cron
  name: mealdirect-reconcile-wallet-balances
  schedule: '17 2 * * *'
  startCommand: pnpm cron:prod reconcile-wallet-balances
```

Match the surrounding entries' `env`, `plan`, `repo`, `buildCommand` and `envVars` keys exactly — copy them from the neighbouring cron block rather than inventing values.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/reconciliation.service.spec.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/payments src/cron.ts render.yaml test/unit/reconciliation.service.spec.ts && git commit -m "feat(wallet): assert wallet balance against the ledger in the reconciliation sweep"
```

---

## Task 20: Provision the wallet at signup

Lazy provisioning in `WalletsService.getWallet` already guarantees correctness. Doing it at signup as well means the DVA request is queued the moment the account exists, so the account number is usually ready before the customer first opens the wallet screen.

**Files:**

- Modify: `src/modules/auth/supabase-auth.service.ts`, `src/modules/auth/auth.module.ts`
- Test: `test/unit/supabase-auth.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or append `test/unit/supabase-auth-wallet.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { provisionWalletForRole } from '../../src/modules/auth/supabase-auth.service.js';

describe('provisionWalletForRole', () => {
  it('provisions a wallet for a new customer', async () => {
    const ensureWallet = vi.fn().mockResolvedValue('wallet-1');

    await provisionWalletForRole({ ensureWallet }, 'customer', 'user-1');

    expect(ensureWallet).toHaveBeenCalledWith('user-1');
  });

  it('does not provision for vendors or riders', async () => {
    const ensureWallet = vi.fn();

    await provisionWalletForRole({ ensureWallet }, 'vendor', 'user-2');
    await provisionWalletForRole({ ensureWallet }, 'rider', 'user-3');

    expect(ensureWallet).not.toHaveBeenCalled();
  });

  it('never fails signup when provisioning throws', async () => {
    const ensureWallet = vi.fn().mockRejectedValue(new Error('database down'));

    await expect(
      provisionWalletForRole({ ensureWallet }, 'customer', 'user-4')
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/supabase-auth-wallet.spec.ts`
Expected: FAIL — `provisionWalletForRole` is not exported.

- [ ] **Step 3: Add the helper and call it**

In `src/modules/auth/supabase-auth.service.ts`, add the exported helper near the top of the file:

```ts
import { Logger } from '@nestjs/common';

type WalletProvisioner = { ensureWallet: (userId: string) => Promise<string> };

const walletProvisioningLogger = new Logger('WalletProvisioning');

/**
 * Queue wallet + DVA provisioning for a brand-new customer. Vendors and riders hold no
 * wallet — they are paid by Paystack transfer through payout.service.ts. Failure is
 * swallowed and logged: a customer who cannot be given a wallet at signup still gets one
 * lazily on their first GET /wallet, and a wallet problem must never block a signup.
 */
export async function provisionWalletForRole(
  wallets: WalletProvisioner,
  role: string,
  userId: string
): Promise<void> {
  if (role !== 'customer') return;
  try {
    await wallets.ensureWallet(userId);
  } catch (error) {
    walletProvisioningLogger.warn(
      `Failed to provision wallet for ${userId}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
}
```

Inject `WalletsRepository` into `SupabaseAuthService` and call the helper inside `signUp`, right after the block that sets `app_metadata.meal_direct_role` (around `src/modules/auth/supabase-auth.service.ts:238`):

```ts
await provisionWalletForRole(this.wallets, role, user.id);
```

- [ ] **Step 4: Wire the dependency**

In `src/modules/auth/auth.module.ts`, import `WalletsRepository` from `../wallets/wallets.repository.js` and add it to `providers`. Do **not** import `WalletsModule` — `WalletsModule` already imports `AuthModule`, and a module-level cycle would break bootstrap. Providing the repository class directly keeps the dependency one-way.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/supabase-auth-wallet.spec.ts test/integration/auth.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth test/unit/supabase-auth-wallet.spec.ts && git commit -m "feat(wallet): provision a customer wallet at signup without blocking signup on failure"
```

---

## Task 21: Cutover backfill script

**Files:**

- Create: `scripts/backfill-wallets.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/backfill-wallets.ts`:

```ts
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';

import { AppModule } from '../src/app.module.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';
import { DatabaseService } from '../src/database/database.service.js';
import { JsonLogger } from '../src/common/logging/json-logger.service.js';

/**
 * Cutover backfill. Provisions a wallet for every existing customer that has none, which also
 * queues one wallet.dva_requested event each; the outbox worker then creates the Paystack
 * customer and dedicated account at its own pace (and does nothing while WALLET_DVA_ENABLED
 * is off). Safe to re-run: ensure_customer_wallet is idempotent and emits at most one event
 * per wallet.
 *
 * Usage: pnpm backfill:wallets [batchSize]
 */
async function backfillWallets(batchSize: number): Promise<void> {
  loadEnvironmentFiles();
  parseEnvironment();

  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    bufferLogs: true,
    logger: false
  });

  const logger = app.get(JsonLogger);
  const database = app.get(DatabaseService);
  app.useLogger(logger);

  try {
    let provisioned = 0;

    for (;;) {
      // Customers are profiles with no vendor and no rider record — the same shape the
      // admin user list uses to classify a user.
      const result = await sql<{ provisioned: number }>`
        with candidates as (
          select p.id
          from public.profiles p
          left join public.wallets w on w.user_id = p.id
          where w.id is null
            and not exists (select 1 from public.vendor_users vu where vu.user_id = p.id)
            and not exists (select 1 from public.riders r where r.user_id = p.id)
          order by p.created_at
          limit ${batchSize}
        )
        select count(public.ensure_customer_wallet(c.id))::integer as "provisioned"
        from candidates c
      `.execute(database.db);

      const batch = result.rows[0]?.provisioned ?? 0;
      provisioned += batch;
      logger.log({ message: 'Wallet backfill batch complete', batch, provisioned }, 'Backfill');

      if (batch < batchSize) break;
    }

    logger.log({ message: 'Wallet backfill complete', provisioned }, 'Backfill');
  } finally {
    await app.close();
  }
}

const requestedBatchSize = Number.parseInt(process.argv[2] ?? '500', 10);
backfillWallets(Number.isFinite(requestedBatchSize) ? requestedBatchSize : 500).catch(
  (error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        context: 'Backfill',
        message: error instanceof Error ? error.message : 'Unknown backfill failure'
      })
    );
    process.exit(1);
  }
);
```

- [ ] **Step 2: Add the script entry**

In `package.json`, add next to the other one-shot scripts:

```json
    "backfill:wallets": "tsx scripts/backfill-wallets.ts",
```

- [ ] **Step 3: Verify it runs against a local database**

Run: `pnpm db:reset && pnpm backfill:wallets 100`
Expected: log lines ending in `Wallet backfill complete` with a `provisioned` count matching the seeded customers, and a second run reporting `provisioned: 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-wallets.ts package.json && git commit -m "feat(wallet): add idempotent cutover backfill for existing customer wallets"
```

---

## Task 22: OpenAPI, docs and full verification

**Files:**

- Modify: `docs/openapi.json`, `docs/openapi.yaml`, `README.md`, `docs/superpowers/specs/2026-07-25-v2-roadmap.md`

- [ ] **Step 1: Regenerate the OpenAPI documents**

Run: `pnpm openapi:generate`
Expected: `docs/openapi.json` and `docs/openapi.yaml` gain `/wallet`, `/wallet/ledger`, `/wallet/dedicated-account`, `/admin/wallets`, `/admin/wallets/{walletId}/ledger`, `/admin/wallets/{walletId}/adjust`, `/admin/wallets/{walletId}/freeze`, `/admin/settings`, plus `paymentMethod` on the create-order body and the 402 response on `POST /orders`.

- [ ] **Step 2: Verify the generated documents are committed**

Run: `pnpm openapi:check`
Expected: exit 0 — no diff after regeneration.

- [ ] **Step 3: Document the new environment variables**

In `README.md`, add to the environment-variable table (matching the surrounding rows' format):

| Variable              | Default     | Purpose                                                                                                                                                             |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WALLET_DVA_ENABLED`  | `false`     | Enables Paystack dedicated virtual account provisioning. Keep false until Paystack support enables DVA on the account; wallets still work, funded by checkout link. |
| `WALLET_DVA_PROVIDER` | `test-bank` | DVA provider slug. `test-bank` in Paystack test mode; `wema-bank` or `titan-paystack` in live.                                                                      |

- [ ] **Step 4: Mark slice A done in the roadmap**

In `docs/superpowers/specs/2026-07-25-v2-roadmap.md`, under `## Specs`, change the slice A line to:

```markdown
- Slice A — [2026-07-25-wallet-dedicated-account-design.md](2026-07-25-wallet-dedicated-account-design.md) — implemented, see [plan](../plans/2026-07-27-wallet-dedicated-account.md)
```

- [ ] **Step 5: Run the full local gate**

Run: `pnpm ci`
Expected: `format:check`, `lint`, `typecheck`, `test:coverage`, `test:no-skips`, `openapi:check` and `db:ci` all pass. Fix anything that fails before continuing — do not proceed on a red suite.

- [ ] **Step 6: Commit**

```bash
git add docs README.md && git commit -m "docs(wallet): regenerate OpenAPI, document DVA env vars and mark v2 slice A implemented"
```

---

## Launch checklist (not code — do these before the v2 cutover deploy)

These are the spec's open items. None of them block writing the code; all of them block turning `WALLET_DVA_ENABLED` on.

- [ ] Request dedicated virtual accounts from Paystack support. This is the long pole for the slice.
- [ ] Confirm the registered business category on the Paystack dashboard is **not** betting, financial services or general services. If it is, a per-customer BVN plus bank-account validation step must be added to `WalletDvaHandler` before provisioning — the spec assumes no KYC step and that assumption is category-dependent.
- [ ] Choose the live DVA provider (Wema or Paystack-Titan) and set `WALLET_DVA_PROVIDER` accordingly. `test-bank` only works in test mode.
- [ ] Apply all five migrations to the hosted database by hand via `psql` in filename order — `20260727000100` → `20260727000150` → `20260727000200` → `20260727000300` → `20260727000400`. The 150 file must be committed before 200 runs, or the enum values will not exist.
- [ ] Run `pnpm backfill:wallets` once after the migrations land.
- [ ] Register `mealdirect-reconcile-wallet-balances` on Render and confirm the first run logs a `detected` count.
- [ ] Confirm the Paystack webhook URL is unchanged — `dedicated_nuban` charges arrive on the same `charge.success` endpoint, no new endpoint to register.

---

## Self-review

**Spec coverage.** Every section of `2026-07-25-wallet-dedicated-account-design.md` maps to a task: data model → Tasks 1–3; `create_paid_order_from_wallet` → Task 4; admin adjust/freeze, refund-to-wallet, drift detection → Tasks 5, 18, 19; limits-are-advisory → the cap flag in `credit_wallet_topup` (Task 3) and the advisory values returned on `GET /wallet` (Tasks 9, 11); provisioning → Tasks 17, 20, 21; top-up by transfer → Task 15; checkout-from-wallet API → Task 14; API surface → Tasks 11–13; reconciliation → Task 19; the seven listed test scenarios → concurrent debit and ledger invariant (Task 4 pgTAP plus the `for update` lock), webhook replay (Task 3 pgTAP), insufficient balance (Tasks 4 and 6), refund to wallet (Task 18), append-only enforcement (Task 3 pgTAP), frozen wallet (Tasks 4 and 5 pgTAP). The four spec risks are handled by the `WALLET_DVA_ENABLED` gate, the launch checklist, the no-withdrawals design, and the `destination: 'paystack'` escape hatch.

**Known gaps, stated plainly.** Two spec test scenarios are only partly covered by automated tests. The **concurrent debit** case (two simultaneous orders against one wallet with funds for one) cannot be expressed in a single-session pgTAP file; the `select ... for update` on the wallet row plus the `balance_kobo >= 0` check constraint make the race safe by construction, but proving it needs a two-connection test. Add it to `test/production/database-production-gates.spec.ts`, which already holds real-connection tests, if you want it asserted rather than argued. The **property test over random credit/debit sequences** is likewise not written; the invariant it would assert is the same one `detect_wallet_balance_drift()` checks nightly in production.

**Type consistency.** `WalletsRepositoryContract` (Task 8) is implemented by `WalletsRepository` (Task 8) and faked identically in Tasks 9 and 10. `ensureWallet` returns `Promise<string>` everywhere, including the `WalletProvisioner` shape in Task 20. `DedicatedAccountRecord` is the single account shape across repository, service, DTO and controller. `WalletPage<T>` carries `{ items, hasMore, limit, nextCursor? }` and is unwrapped into `createListEnvelope` the same way in all four list endpoints. `createWalletOrder` takes the identical seven parameters as `createOrder` in both the contract and the implementation.
