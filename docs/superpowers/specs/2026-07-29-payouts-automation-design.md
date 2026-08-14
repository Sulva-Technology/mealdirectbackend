# Slice E — Vendor & rider payouts via Paystack (automated)

**Date:** 2026-07-29
**Branch:** continues `feat/v2-wallet-dedicated-account` (single v2 cutover, one migration set)
**Status:** Design approved; awaiting spec review before planning.
**Depends on:** slice B ([2026-07-28-fee-model-timing-design.md](2026-07-28-fee-model-timing-design.md)) —
settlements now accrue the resolved `rider_delivery_share_kobo` / `vendor_delivery_share_kobo`, and
`payable_kobo` already sums them, so payouts pay the correct amounts with no change here.

## Goal

Flip payouts from **manual admin disbursement** to **automated Paystack transfers** behind
`PAYOUTS_ENABLED`, driven by a scheduled pay-run, with active reconciliation, bounded retry, an
admin approval gate on both beneficiary types, and a documented flip checklist. The Paystack
integration is already built (recipient provisioning, `initiateTransfer`, webhook reconcile); this
slice is **enablement + gap-closing**, not new integration.

## What already exists (do not rebuild)

- **Recipient provisioning for both parties.** `vendors.service` and the riders module each create a
  Paystack transfer recipient at bank-detail capture, storing only the masked number +
  `paystack_recipient_code`.
- **`POST /settlements/:id/pay` → `PayoutService.payToSettlement`**, gated on `PAYOUTS_ENABLED`,
  idempotent per settlement, recording a `payout_transfers` row.
- **Webhook reconcile:** Paystack `transfer.success/failed/reversed` → internal `TRANSFER_RECONCILED`
  → `reconcile_payout_transfer(reference, status, payload)`.
- **`payable_kobo`** already includes the resolved delivery shares
  (`produce_rider_daily_settlement` sums `rider_delivery_share_kobo`; `produce_vendor_daily_settlement`
  = food + `sum(vendor_delivery_share_kobo)` + service − refunds).

## Gaps this slice closes

1. No automated trigger — payouts only fire on an admin click.
2. No active reconcile fallback — a transfer whose webhook is missed stays `pending` forever.
3. No retry — a `failed` transfer's row is returned as-is (idempotent), so it cannot be re-attempted.
4. Asymmetric approval — riders have `admin_review_status`, vendors do not; no admin endpoint sets
   it, and no admin visibility of payout transfers.
5. No documented flip criteria for `PAYOUTS_ENABLED`.

## Architecture & flow

### The pay-run (`run-payouts` cron)

A new cron job (in `src/cron.ts`, registered on Render alongside the existing reconcile jobs). Each
run, and only when `PAYOUTS_ENABLED` is true, it selects **eligible** settlements and initiates one
Paystack transfer per settlement through the existing `initiateTransfer` path, recording each in
`payout_transfers`.

**Eligibility (all must hold):**

- `settlements.payable_kobo > 0`.
- Beneficiary payout account is `active`, has a non-null `paystack_recipient_code`, and
  `admin_review_status = 'approved'` (vendor via `vendor_payout_accounts`, rider via
  `rider_payout_accounts`).
- The settlement is older than the **hold period**: `settlements.created_at <= now() - (payout_hold_hours || ' hours')::interval`.
- No `successful` and no `pending` transfer already exists for the settlement.
- The count of `failed` attempts for the settlement is `< payout_max_attempts`.

Selection is a single SQL function (`select_payable_settlements(p_hold_hours, p_max_attempts, p_limit)`)
so the invariants live in one auditable place and the Nest job stays thin. The job iterates the
returned settlement ids and calls `payToSettlement` per id (reused, extended for attempts below).

### Bounded auto-retry

`payout_transfers` becomes **multi-attempt per settlement**:

- Add `attempt integer not null default 1`.
- Replace `unique(settlement_id)` with `unique(settlement_id, attempt)`.
- The transfer **reference** becomes per-attempt: `'<settlementId>-a<attempt>'`, so Paystack sees a
  fresh reference on every retry (a reused reference is rejected/duplicated). `reconcile_payout_transfer`
  still looks up by `reference`, so no change to its lookup.
- When the pay-run (or a manual `POST /:id/pay`) initiates a transfer, it computes the next attempt =
  `coalesce(max(attempt), 0) + 1` for that settlement.
- After `payout_max_attempts` failed attempts, the settlement is **parked**: the pay-run no longer
  selects it, and the latest row's status is surfaced as `needs_admin` for the admin queue. (A
  `needs_admin` is a derived/queue state — modeled by "max failed attempts reached and no success",
  computed in the admin list query; no separate write needed. If a stored marker is cleaner during
  implementation, add a `payout_transfers.needs_admin boolean`, but prefer the derived form.)

Idempotency is preserved: a settlement with a `successful` or in-flight `pending` transfer is never
re-selected, and the unique `(settlement_id, attempt)` prevents duplicate attempt rows under a race.

### Active reconcile (`reconcile-payout-transfers` cron)

Mirrors `reconcile-pending-payments`. A new cron job + `PayoutService.reconcilePendingPayouts()`:

- Selects `payout_transfers` in `pending` status past a short grace window.
- Calls a **new** `PaystackClient.fetchTransfer(reference | transferCode)` to read the authoritative
  status.
- Applies `reconcile_payout_transfer(reference, status, payload)` to move the row to
  `success`/`failed`/`reversed`.

The webhook stays the primary path; this is the fallback for missed/late webhooks. Wire it into the
existing cron dispatcher switch and Render schedule.

## Data model changes (new migrations, prefix `20260729######`, after slice-D `20260729000200`)

### `vendor_payout_accounts`

```
alter table public.vendor_payout_accounts
  add column admin_review_status text not null default 'pending'
    check (admin_review_status in ('pending', 'approved', 'rejected')),
  add column failure_reason text;
```

Mirrors `rider_payout_accounts` (added by `20260703000500`). Vendors cannot change
`admin_review_status` themselves (enforced by the existing vendor RLS/update path, which whitelists
mutable columns; verify the payout-account update in `vendors.service`/repo does not pass it).

### `payout_transfers`

```
alter table public.payout_transfers
  add column attempt integer not null default 1;

alter table public.payout_transfers
  drop constraint payout_transfers_settlement_id_key;   -- confirm exact constraint name first

alter table public.payout_transfers
  add constraint payout_transfers_settlement_attempt_key unique (settlement_id, attempt);
```

`reconcile_payout_transfer` and `recordTransfer` are updated to the per-attempt reference and the new
uniqueness. `select_payable_settlements(...)` is added.

### `platform_settings` — seeded keys

```
payout_hold_hours     24   -- minimum settlement age before auto-pay
payout_max_attempts    3   -- failed attempts before parking as needs_admin
```

Read through `platform_setting_int(key, default)`; a missing/malformed row falls back to the app
default and can never silently change payout behaviour.

## Application changes (Nest / TS)

- `src/cron.ts` — add `run-payouts` and `reconcile-payout-transfers` to the job list + dispatcher.
- `PayoutService` — `runPayouts()` (select eligible via the SQL function, initiate per settlement,
  respect `PAYOUTS_ENABLED`); `reconcilePendingPayouts()` (active-verify pending transfers);
  `payToSettlement` extended to compute the next `attempt` and per-attempt reference.
- `PaystackClient` / `PaystackClientContract` — add `fetchTransfer(referenceOrCode)`.
- `PayoutRepository` — `listPendingTransfers()`, next-attempt computation, per-attempt insert.
- **Admin surface** (new, under a `payouts:manage` RBAC permission mirroring `wallets:manage`):
  - `PATCH /admin/payout-accounts/vendor/:vendorId/review` and
    `PATCH /admin/payout-accounts/rider/:riderId/review` — set `admin_review_status` +
    `failure_reason`, audited via `AuditService`.
  - `GET /admin/payout-transfers` — keyset-paginated, filter by status (incl. `failed` /
    `needs_admin`); `GET /admin/payout-transfers/:id` for detail. Reuse `decodeListCursor`/`toList`.

## Error handling

- **`PAYOUTS_ENABLED` off:** `runPayouts()` is a no-op that logs and returns; `payToSettlement`
  keeps its existing 403.
- **No recipient / not approved / on hold:** the settlement is simply not selected — no error, it is
  retried on a later run once eligible.
- **Transfer failure:** recorded as a `failed` attempt; re-attempted next run up to
  `payout_max_attempts`, then parked as `needs_admin` for the admin queue.
- **Missed webhook:** the reconcile cron actively verifies and settles the row.
- **Duplicate/racing pay-run:** `unique(settlement_id, attempt)` plus the "no pending/successful
  transfer" filter prevent double-sends.

## Flip criteria for `PAYOUTS_ENABLED`

A short operational checklist (documented in the spec and repeated in the memory/runbook):

1. Vendor & rider payout accounts provisioned (recipient codes present) and **admin-approved**.
2. Paystack transfer balance funded; transfers enabled on the Paystack account (OTP policy decided).
3. Both crons (`run-payouts`, `reconcile-payout-transfers`) registered on Render with sane schedules
   (pay-run daily after settlement generation; reconcile every ~15 min like payments).
4. Guardrail settings seeded (`payout_hold_hours`, `payout_max_attempts`).
5. One end-to-end test transfer to a real account verified and reconciled.
6. Admin payout-transfer queue reviewed as the failure escape hatch.

## Testing

- **pgTAP:** `select_payable_settlements` picks only approved + held + unpaid + payable settlements
  and excludes ones with a pending/successful transfer or exhausted attempts; per-attempt uniqueness;
  `reconcile_payout_transfer` transitions on success/failed/reversed; `admin_review_status` defaults
  to `pending` and is check-constrained.
- **Unit (Vitest):** pay-run selection + guardrails + `PAYOUTS_ENABLED` gate; bounded-retry attempt
  increment and cap → parked; reconcile active-verify calls `fetchTransfer` and applies the status;
  admin approve/reject writes `admin_review_status` + audit; `fetchTransfer` client method.
- `pnpm test`, `pnpm typecheck`, `pnpm openapi:check` green; `pnpm db:ci` + `database.types.ts` regen
  on a Docker host (this machine — once Docker is up).

## Out of scope

- Per-transfer amount cap and daily-total kill-switch (declined during design).
- Changes to settlement generation or the fee math (already correct after slice B).
- A bulk "pay all now" admin action beyond the automated run and the existing per-settlement override.
