# Phase 3 — Money & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate vendor/rider payouts via Paystack Transfers behind an admin approval gate, move JWT verification to asymmetric JWKS, add password-reset/email-confirmation flows, remove dead module stubs, and finish observability + launch verification.

**Architecture:** `PaystackClient` gains transfer-recipient and transfer operations. Settlement approval provisions a recipient (idempotently) and initiates a transfer, recording its state; a transfer webhook reconciles success/failure/reversal. Transfers are feature-flagged off until enabled. Auth verification switches from a shared HS256 secret to the Supabase JWKS endpoint with key caching.

**Tech Stack:** NestJS 11, Kysely + `pg`, Supabase Postgres 15, Paystack Transfers API, `jose` (already a dependency), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-18-production-readiness-design.md` (Phase 3).

**Prerequisite:** Phases 0–2 merged.

---

## Background facts (verified in code)

- `vendor_payout_accounts.paystack_recipient_code` exists (`migration 300:59`); `riders` has
  **no** recipient column (`migration 300:82`).
- `PaystackClient` (`src/modules/payments/paystack.client.ts`) implements only
  `initializeTransaction`, `verifyTransaction`, `createRefund` via a private `request()`
  helper; the webhook (`paystack-webhook.service.ts`) verifies HMAC and records events through
  `record_payment_event`, marking success via `mark_verified_payment_successful`.
- Settlement statuses use `public.settlement_status` (`settlements.status` default `draft`);
  admin endpoints already expose approve/mark-paid (`working-memory.md`).
- Auth: `signUp/signIn/refresh/signOut` via `@supabase/supabase-js`
  (`supabase-auth.service.ts`); JWT verification uses a shared `SUPABASE_JWT_SECRET`
  (HS256) per `env.ts` `superRefine`. `enable_confirmations = false` in `config.toml`.

---

## File Structure

- `supabase/migrations/<ts>_payout_transfers.sql` (+ pgTAP) — rider recipient column + `payout_transfers` table + state functions (create).
- `src/modules/payments/paystack.client.ts` — add transfer recipient + transfer methods (modify).
- `src/modules/payments/payments.types.ts` — transfer types (modify).
- `src/modules/settlements/payout.service.ts` (+ test) — provision recipient + initiate transfer (create).
- `src/modules/settlements/settlements.controller.ts` — admin `POST /settlements/:id/pay` (modify).
- `src/modules/payments/paystack-webhook.service.ts` — handle `transfer.*` events (modify).
- `src/config/env.ts` — `PAYOUTS_ENABLED` flag (modify).
- `src/modules/auth/supabase-jwt.service.ts` (+ test) — JWKS verification (modify).
- `src/modules/auth/auth.controller.ts` / `supabase-auth.service.ts` — password reset + resend confirmation (modify).
- `src/modules/{deliveries,locations,slots,audit}` — implement or remove stubs (modify/delete).
- `docs/operations/observability.md`, `docs/go-live-checklist.md` — finalize (modify).

---

## Task 1: Paystack transfer client methods

**Files:**
- Modify: `src/modules/payments/paystack.client.ts`, `src/modules/payments/payments.types.ts`
- Create: `test/unit/paystack-transfers.spec.ts`

- [ ] **Step 1: Add transfer types**

In `payments.types.ts` add:

```ts
export type PaystackRecipientInput = {
  name: string; accountNumber: string; bankCode: string; currency: string;
};
export type PaystackRecipientResult = { recipientCode: string; providerPayload: Record<string, unknown> };
export type PaystackTransferInput = {
  amountKobo: number; recipientCode: string; reference: string; reason?: string;
};
export type PaystackTransferResult = {
  transferCode: string; status: string; providerPayload: Record<string, unknown>;
};
```

Add the two methods to `PaystackClientContract`.

- [ ] **Step 2: Write failing tests**

Create `test/unit/paystack-transfers.spec.ts` using a fetch mock (mirror existing Paystack
client tests) asserting `createTransferRecipient` POSTs to `/transferrecipient` and returns
`recipientCode` from `data.recipient_code`, and `initiateTransfer` POSTs to `/transfer` with
`source: 'balance'` and returns `transferCode`/`status`.

- [ ] **Step 3: Implement methods on `PaystackClient`**

```ts
async createTransferRecipient(input: PaystackRecipientInput): Promise<PaystackRecipientResult> {
  const envelope = await this.request('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban', name: input.name, account_number: input.accountNumber,
      bank_code: input.bankCode, currency: input.currency
    })
  });
  if (!isRecord(envelope.data)) throw badGateway('Paystack recipient returned an invalid response.');
  const recipientCode = stringFrom(envelope.data.recipient_code);
  if (recipientCode === undefined) throw badGateway('Paystack recipient response was missing a code.');
  return { recipientCode, providerPayload: this.providerPayload(envelope) };
}

async initiateTransfer(input: PaystackTransferInput): Promise<PaystackTransferResult> {
  const envelope = await this.request('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance', amount: input.amountKobo, recipient: input.recipientCode,
      reference: input.reference, reason: input.reason
    })
  });
  if (!isRecord(envelope.data)) throw badGateway('Paystack transfer returned an invalid response.');
  const transferCode = stringFrom(envelope.data.transfer_code);
  const status = stringFrom(envelope.data.status) ?? 'pending';
  if (transferCode === undefined) throw badGateway('Paystack transfer response was missing a code.');
  return { transferCode, status, providerPayload: this.providerPayload(envelope) };
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm vitest run test/unit/paystack-transfers.spec.ts && pnpm typecheck`
```bash
git add src/modules/payments/paystack.client.ts src/modules/payments/payments.types.ts test/unit/paystack-transfers.spec.ts
git commit -m "feat(payments): add Paystack transfer recipient and transfer methods"
```

---

## Task 2: Payout schema + state functions

**Files:**
- Create: `supabase/migrations/<ts>_payout_transfers.sql`, `supabase/tests/database/payout_transfers_test.sql`

- [ ] **Step 1: Migration**

`supabase migration new payout_transfers`:

```sql
begin;

alter table public.riders
  add column if not exists paystack_recipient_code text;

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

create index payout_transfers_status_idx on public.payout_transfers (status);

create trigger payout_transfers_set_updated_at
before update on public.payout_transfers
for each row execute function public.set_updated_at();

-- Reconcile a transfer by reference (called by the webhook); updates settlement status.
create or replace function public.reconcile_payout_transfer(p_reference text, p_status text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_settlement_id uuid;
begin
  update public.payout_transfers
  set status = p_status, provider_payload = p_payload
  where reference = p_reference
  returning settlement_id into v_settlement_id;

  if v_settlement_id is not null and p_status = 'success' then
    update public.settlements set status = 'paid' where id = v_settlement_id;
  end if;
end;
$$;

commit;
```

pgTAP `payout_transfers_test.sql`: insert a settlement + payout_transfer, call
`reconcile_payout_transfer(ref,'success',...)`, assert transfer status `success` and
settlement status `paid`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types`
```bash
git add supabase/migrations supabase/tests/database/payout_transfers_test.sql supabase/types/database.types.ts
git commit -m "feat(db): payout transfers table and reconciliation function"
```

---

## Task 3: Payout service behind an approval gate

**Files:**
- Modify: `src/config/env.ts`, `src/modules/settlements/settlements.controller.ts`, `src/modules/settlements/settlements.module.ts`
- Create: `src/modules/settlements/payout.service.ts`, `src/modules/settlements/payout.repository.ts`, `test/unit/payout.service.spec.ts`

- [ ] **Step 1: Feature flag env**

In `src/config/env.ts` `z.object`: `PAYOUTS_ENABLED: booleanFromString.default(false),`.

- [ ] **Step 2: Write failing service test**

Create `test/unit/payout.service.spec.ts` asserting:
- throws when `PAYOUTS_ENABLED` is false;
- provisions a recipient when the payout account has no `paystack_recipient_code`, persists it,
  then initiates a transfer and records a `payout_transfers` row with the returned code;
- reuses the existing recipient code when present (no second `createTransferRecipient` call);
- is idempotent per settlement (second call with an existing transfer returns it without a new
  Paystack call).

Use a fake `PaystackClientContract` and a fake repository.

- [ ] **Step 3: Implement `PayoutService` + `PayoutRepository`**

`PayoutService.payToSettlement(actor, settlementId)`:
1. assert `super_admin` (reuse role check) and `env.get('PAYOUTS_ENABLED')`;
2. load settlement + its vendor/rider payout destination via repository;
3. if no recipient code, `paystack.createTransferRecipient(...)` and persist it on the
   `vendor_payout_accounts` row (or `riders.paystack_recipient_code`);
4. generate a stable `reference` (e.g. `settlement.id`), `paystack.initiateTransfer(...)`,
   insert `payout_transfers` (`on conflict (settlement_id) do nothing`);
5. return the transfer record.

- [ ] **Step 4: Controller endpoint**

Add `POST /v1/admin/settlements/:id/pay` to the settlements admin surface (super-admin
guard), calling `PayoutService.payToSettlement`. Register `PayoutService`/`PayoutRepository`
in `settlements.module.ts`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm vitest run test/unit/payout.service.spec.ts && pnpm openapi:generate`
```bash
git add src/config/env.ts src/modules/settlements docs/openapi.json docs/openapi.yaml test/unit/payout.service.spec.ts
git commit -m "feat(settlements): gated automated payout via Paystack transfers"
```

---

## Task 4: Transfer webhook reconciliation

**Files:**
- Modify: `src/modules/payments/paystack-webhook.service.ts`, `src/domain/payments.ts`
- Create/extend: `test/integration/paystack-webhook.spec.ts`

- [ ] **Step 1: Map transfer events (test-first)**

Extend `mapPaystackEvent` in `src/domain/payments.ts` to recognize `transfer.success`,
`transfer.failed`, `transfer.reversed`, returning `{ type, reference, status }`. Add unit
cases in the existing payments domain spec.

- [ ] **Step 2: Handle in the webhook service**

In `paystack-webhook.service.ts` `processWithDatabase`, after recording the event, when the
mapped type is a transfer event call:

```ts
await sql`select public.reconcile_payout_transfer(${reference}, ${status}, ${JSON.stringify(payload)}::jsonb)`.execute(trx);
```

- [ ] **Step 3: Integration test**

Add a case to `test/integration/paystack-webhook.spec.ts`: seed a `payout_transfers` row,
POST a signed `transfer.success` webhook, assert the transfer + settlement become
`success`/`paid`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm typecheck && pnpm vitest run test/integration/paystack-webhook.spec.ts`
```bash
git add src/domain/payments.ts src/modules/payments/paystack-webhook.service.ts test/integration/paystack-webhook.spec.ts
git commit -m "feat(payments): reconcile settlement payouts from transfer webhooks"
```

---

## Task 5: Asymmetric JWKS verification

**Files:**
- Modify: `src/modules/auth/supabase-jwt.service.ts`, `src/config/env.ts`
- Modify: `test/unit/rbac.spec.ts` or the auth/jwt unit test

- [ ] **Step 1: Add JWKS env**

In `src/config/env.ts` add `SUPABASE_JWKS_URL: z.url().optional()` and relax the
`SUPABASE_JWT_SECRET` requirement to: required only when `SUPABASE_JWKS_URL` is unset in
staging/production (update the `superRefine` condition accordingly).

- [ ] **Step 2: Test-first**

In the JWT service unit test, add a case verifying that when `SUPABASE_JWKS_URL` is set the
service verifies an RS256/ES256 token via a JWKS key set (use `jose`'s
`createLocalJWKSet` with a generated key pair in the test), and still accepts HS256 when only
the secret is configured.

- [ ] **Step 3: Implement**

In `supabase-jwt.service.ts`, when `SUPABASE_JWKS_URL` is configured use
`createRemoteJWKSet(new URL(url))` with `jwtVerify(token, jwks, { issuer, audience })`
(cache the key set on the instance); otherwise fall back to the existing HS256 secret path.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm vitest run`
```bash
git add src/modules/auth/supabase-jwt.service.ts src/config/env.ts test
git commit -m "feat(auth): support asymmetric JWKS verification with HS256 fallback"
```

---

## Task 6: Password reset + email confirmation flows

**Files:**
- Modify: `src/modules/auth/auth.controller.ts`, `src/modules/auth/supabase-auth.service.ts`, `src/modules/auth/dto/auth.dto.ts`
- Modify: `supabase/config.toml`
- Create: extend `test/integration/auth.spec.ts`

- [ ] **Step 1: Service methods**

Add to `SupabaseAuthService`: `requestPasswordReset(email)` →
`client.auth.resetPasswordForEmail(email, { redirectTo })`; `resendConfirmation(email)` →
`client.auth.resend({ type: 'signup', email })`. Both swallow not-found to avoid user
enumeration (return success regardless).

- [ ] **Step 2: Endpoints**

Add `POST /v1/auth/password-reset` and `POST /v1/auth/resend-confirmation` (DTOs with email).
Set `enable_confirmations = true` under `[auth.email]` in `supabase/config.toml`.

- [ ] **Step 3: Integration test**

Extend `test/integration/auth.spec.ts` asserting both endpoints return 200 for any email
(non-enumerating) and validate input shape.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm vitest run test/integration/auth.spec.ts && pnpm openapi:generate`
```bash
git add src/modules/auth supabase/config.toml docs/openapi.json docs/openapi.yaml test/integration/auth.spec.ts
git commit -m "feat(auth): password reset and resend confirmation endpoints"
```

---

## Task 7: Resolve empty module stubs

**Files:**
- Modify/Delete: `src/modules/deliveries/deliveries.module.ts`, `src/modules/locations/*`, `src/modules/slots/*`, `src/modules/audit/*`
- Modify: `src/modules/capability-modules.ts`

- [ ] **Step 1: Decide per module**

Grep each module name across `src/` to confirm it provides nothing consumed elsewhere:
`pnpm exec rg -n "LocationsModule|SlotsModule|AuditModule|DeliveriesModule" src`. For each that
is an empty `@Module({})` with no controllers/providers and no external consumers, remove the
file and its entry in `capability-modules.ts` / `app.module.ts`. Keep `DeliveriesModule` only
if you add a delivery read-model controller; otherwise remove it too (Realtime + rider
endpoints already cover delivery state).

- [ ] **Step 2: Verify nothing breaks**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS (app boots without the removed modules).

- [ ] **Step 3: Commit**

```bash
git add src/modules/capability-modules.ts src/app.module.ts src/modules
git commit -m "chore(modules): remove empty placeholder modules"
```

---

## Task 8: Observability finalization + launch verification

**Files:**
- Modify: `docs/operations/observability.md`, `docs/go-live-checklist.md`

- [ ] **Step 1: Expand Sentry context + alerts**

Confirm the Phase 0 Sentry reporter is enabled in prod; add release/environment tagging notes
and alert thresholds (error rate, `/health/ready` downtime, worker dead-letter count via the
`outbox_events.failed_at` metric) to `docs/operations/observability.md`.

- [ ] **Step 2: Full readiness gate**

Run: `pnpm readiness:launch`
Expected: format, lint, typecheck, tests, no-skips, OpenAPI check, build, hosted E2E, and
production smoke all PASS.

- [ ] **Step 3: Update go-live checklist + commit**

Tick the remaining items in `docs/go-live-checklist.md` (payouts gate, JWKS, notifications,
realtime, dispatch) and note `PAYOUTS_ENABLED` stays false until a controlled enablement.
```bash
git add docs/operations/observability.md docs/go-live-checklist.md
git commit -m "docs: finalize observability and go-live verification for production"
```

---

## Self-Review

- **Spec coverage (Phase 3):** automated payouts → Tasks 1–4; JWKS → Task 5; password
  reset/email confirmation → Task 6; module cleanup → Task 7; observability + launch gates →
  Task 8. Covered.
- **Placeholder scan:** `<ts>` is the migration timestamp; Task 7 is intentionally a decision
  task with a concrete grep gate; all code-bearing steps include full code or precise
  `jose`/Supabase API calls.
- **Type consistency:** `PaystackRecipientInput/Result`, `PaystackTransferInput/Result`,
  `PayoutService.payToSettlement`, and `reconcile_payout_transfer(reference, status, payload)`
  are used consistently across client, service, webhook, and DB function.

## Cross-phase done definition
When Phases 0–3 are merged: prod DB is reachable with scheduled maintenance; the outbox worker
delivers email + push; Realtime streams order/notification/assignment changes; pricing is
zoned with promo codes; riders auto-dispatch; payouts run automatically behind an approval
gate and feature flag; auth verifies via JWKS; and the full readiness suite passes — the app
is 100% production-capable per the spec.
