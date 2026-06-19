# Meal Direct Backend — Production Readiness Design

- **Date:** 2026-06-18
- **Status:** Approved design (pre-implementation)
- **Goal:** Take the backend from a near-complete synchronous API to a full production-grade system: working async layer, external notifications, realtime tracking, dynamic pricing/promos, automated dispatch, automated payouts, and operational readiness.

## Context

The synchronous HTTP API is ~90% complete across customer, vendor, rider, and admin
surfaces, with Supabase JWT auth, Kysely repositories over Postgres functions + RLS,
Paystack payment initialize/verify/refund, and broad test coverage. The gaps are
concentrated in the **asynchronous layer, external integrations, and a few
automation/pricing features**.

### Confirmed findings (evidence)

- **Outbox worker is a no-op.** `src/worker.ts` boots a Nest context and logs
  `registeredQueues: ['outbox_events']` but has no poll loop or handler. Events
  accumulate; only a DB trigger turns them into in-app notification rows.
- **Outbox emits only three event types today:** `order.pending_payment_created`,
  `payment.successful`, `order.escalation_opened`
  (`supabase/migrations/20260612000400_*.sql:826/1101/1402`). Status transitions
  (accepted → preparing → ready → picked_up → delivered) emit nothing.
- **No external notification channels.** `src/config/env.ts` has no email/SMS/push
  config. `NotificationsService` is in-app only (list / mark-read / preferences).
- **Pricing engine exists but is unused.** `src/domain/pricing.ts` is a full
  calculator; `src/modules/orders/orders.service.ts:17` hardcodes a flat
  `deliveryFeeKobo = 15_000`, `discountKobo = 0`, no service fee.
- **No Paystack Transfers.** `PaystackClient` only does initialize/verify/refund.
  Payouts are generated as settlements and marked paid manually; no money movement.
- **No auto-dispatch.** Batches form at cutoff via `close_batches_at_cutoff`; rider
  assignment is a manual admin action.
- **DeliveriesModule, locations, slots, audit modules are empty registrations.**
- **Prod DB connectivity unproven.** Last Render deploy returned `DATABASE_UNAVAILABLE`
  on `/v1/health/ready` (Supabase pooler TLS `SELF_SIGNED_CERT_IN_CHAIN`, then password
  auth failure). Order state machine itself is complete (`src/domain/order-status.ts`).

## Decisions

| Decision | Choice |
|----------|--------|
| Target bar | Full production-grade |
| Notification channels | In-app (existing) + **Email** + **Push** (no SMS this round) |
| Payouts | **Manual now, automated in Phase 3** |
| Realtime | **Supabase Realtime** |
| Email provider | **Resend** |
| Push provider | **FCM** (mobile + web) |
| Error tracking / alerting | **Sentry** + uptime alerting on `/health/ready` |
| Scheduler | **pg_cron** (in-database) |
| First deliverable | **Phase 0: fix prod DB `/health/ready`** |

## Approach

Phased single-track, with the **outbox worker as the keystone** (notifications,
dispatch, and payouts all depend on it). Each phase is independently shippable and
testable. All new units are built test-first (TDD), following existing
unit/integration/pgTAP patterns.

| Phase | Theme | Exit gate |
|-------|-------|-----------|
| 0 | Prod connectivity + launch gates | `/health/ready` green in prod; `db:ci` + hosted E2E + production smoke pass |
| 1 | Async core: outbox worker → email + push + Realtime; pricing engine wired | A real customer order produces real notifications + live status tracking |
| 2 | Automation: dynamic/zoned pricing + promos, auto rider dispatch | Hands-off day-to-day operations |
| 3 | Money + hardening: automated Paystack payouts, observability/alerting | Automated settlements behind approval gate; on-call ready |

---

## Phase 0 — Production connectivity & launch gates

**Objective:** the deployed app reliably reaches its database and the existing
verification harness has actually been run end-to-end.

- Fix Supabase pooler TLS + auth in `DatabaseService`: select correct pooler
  (session vs transaction) and connection string, supply Supabase CA or correct
  `rejectUnauthorized` handling without `sslmode` overriding the explicit SSL object
  (partially attempted already). Confirm `/v1/health/ready` returns ready.
- Wire `release-expired-reservations` and `close-batches-at-cutoff` to **pg_cron**.
- Run full `pnpm db:ci` (Supabase CLI + Docker), `pnpm test:e2e:hosted`, and
  `pnpm smoke:production` against a real staging project; fix what surfaces.
- Stand up **Sentry** + uptime alerting on `/health/ready` (baseline, expanded in P3).

**Acceptance:** `/v1/health/ready` green in prod; cron jobs fire on schedule;
`pnpm readiness:launch` passes against staging.

---

## Phase 1 — Async core (the keystone)

### 1.1 Outbox worker
- DB function `claim_outbox_batch(p_worker_id text, p_limit int)` leasing rows with
  `for update skip locked`, setting `locked_at`/`locked_by`, ordered by
  `available_at` (uses `outbox_events_available_idx`).
- Worker poll loop in `src/worker.ts`: claim → dispatch via handler registry →
  on success set `processed_at`; on failure increment `attempts` and push
  `available_at` out with exponential backoff; beyond `max_attempts` mark
  `failed_at` (dead-letter). Configurable poll interval, batch size, concurrency cap.
  Graceful SIGINT/SIGTERM drain. Metrics via existing `MetricsService`.
- **Handler registry:** `event_type → handler[]`. Phase 1 handlers: notification
  dispatch + realtime publish (if any server-side publish is needed beyond DB CDC).

### 1.2 Event taxonomy expansion (DB migrations)
Add `insert into public.outbox_events` to the status-transition / assignment /
settlement DB functions so the system emits:
`order.accepted`, `order.preparing`, `order.ready_for_pickup`,
`order.assigned_to_rider`, `order.picked_up`, `order.delivered`,
`order.cancelled`, `order.refunded`, `settlement.generated`.
Forward-only migrations; pgTAP asserts each transition emits its event with payload.

### 1.3 Notifications: email + push
- `NotificationChannel` interface; `EmailChannel` (Resend) + `PushChannel` (FCM).
- Env additions: `RESEND_API_KEY`, `EMAIL_FROM`, `FCM_*` credentials
  (optional in dev/test, required in staging/prod via `superRefine`).
- Per-event templates (subject/body/data) rendered from outbox payload + a DB
  lookup for order/customer context.
- Preference-aware: the existing trigger keeps writing the in-app row; the worker
  handler adds email/push only for channels the user enabled.
- New `device_tokens` table + `POST /v1/me/device-tokens`, `DELETE /v1/me/device-tokens/:id`
  for frontends to register/unregister push tokens (customer + rider).
- New per-channel **notification delivery log** for idempotency (never double-send)
  and retry/audit.

### 1.4 Supabase Realtime
- Migration adds `orders`, `notifications`, `delivery_assignments` to the
  `supabase_realtime` publication.
- Verify existing RLS restricts realtime rows per role over authenticated channels.
- Deliverable: documented **frontend subscription contract**
  (`docs/api-reference.md` or new doc): channels, row shapes, auth.

### 1.5 Pricing engine wired
- Route order quote + create math through `calculateOrderPricing`.
- Move flat delivery fee + a new service fee into `EnvService` config (still flat in
  Phase 1; dynamic in Phase 2). No behavior change to totals beyond adding service
  fee if configured.

**Acceptance:** placing + paying a real order produces in-app + email + push
notifications and a live status stream; pricing flows through the domain calculator;
worker drains the outbox with retries and dead-lettering, all under test.

---

## Phase 2 — Automation

### 2.1 Dynamic / zoned pricing + promos
- `delivery_fee_kobo` per `campus_zone` (column or small table); quote/create read it.
- New `promotions` module: `promotions` table (code, type, value, min-order,
  starts/ends, usage cap, per-user cap), server-side validation, applied at quote +
  create, recorded on the order. Admin CRUD for promo codes.

### 2.2 Auto rider dispatch
- Rider availability/online flag (column + endpoint).
- Triggered by `order.ready_for_pickup` / batch-closed event in the worker (or a
  short pg_cron `dispatch-sweep`): greedy assignment by zone → current load →
  availability; writes `delivery_assignment`; emits `order.assigned_to_rider`.
- Admin manual override and reassignment remain.

**Acceptance:** orders auto-price by zone, accept valid promo codes, and auto-assign
to an eligible rider without admin action; manual override still works.

---

## Phase 3 — Money & hardening

### 3.1 Automated Paystack payouts
- Extend `PaystackClient`: `createTransferRecipient`, `initiateTransfer`.
- Store recipient codes on `vendor_payout_accounts` / `riders`.
- New `transfer.success/failed/reversed` webhook handling reconciling settlement
  status; **admin approval gate** before any transfer; balance + idempotency guards.
- Feature-flagged off until explicitly enabled.

### 3.2 Auth completion + cleanup
- Password reset + email confirmation endpoints (Supabase-backed).
- Migrate JWT verification from shared HS256 secret to **JWKS/asymmetric**.
- Resolve empty stubs: fold delivery read-models into `DeliveriesModule`; delete
  `locations`/`slots`/`audit` modules if their data is fully served elsewhere.

### 3.3 Observability + launch gates
- Expand Sentry coverage, structured error context, alerting runbooks.
- Final `pnpm readiness:launch` against staging then production promotion.

**Acceptance:** settlements pay out automatically behind an approval gate; auth uses
asymmetric verification; on-call alerting is live; full readiness suite green.

---

## Data model changes (summary)

- `claim_outbox_batch(...)` function; optional `outbox_dead_letter` (or `failed_at`/
  `locked_by` columns on `outbox_events`).
- New outbox `insert` statements in existing transition/assignment/settlement funcs.
- `device_tokens` table; notification delivery-log table.
- `supabase_realtime` publication additions.
- `delivery_fee_kobo` per zone; `promotions` (+ usage) tables.
- Rider availability flag; recipient-code columns for payouts.

All schema changes are forward-only Supabase CLI migrations with pgTAP coverage.

## Testing strategy

- Domain + service logic: Vitest unit tests, test-first.
- HTTP contracts: integration specs per module (existing pattern).
- DB functions/triggers/RLS: pgTAP.
- Worker: unit tests for claim/dispatch/backoff/dead-letter; integration test draining
  a seeded outbox.
- External providers (Resend/FCM/Paystack transfers): wrapped behind interfaces and
  faked in tests (mirrors existing `fake-paystack` helper).
- E2E + production smoke gates run per phase.

## Out of scope (this round)

- SMS notifications.
- Native mobile app work (backend exposes device-token registration only).
- Multi-campus rollout beyond existing schema readiness.
