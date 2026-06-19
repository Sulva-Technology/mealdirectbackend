# Implementation Log — Production Readiness (Phases 0–3)

Executing the four phase plans via subagent-driven-development.

## Environment constraint (important)
- **Docker is NOT available** in the implementation environment (`docker: command not found`;
  local Supabase pooler unreachable). Therefore `pnpm db:reset`, `pnpm db:test` (pgTAP),
  `pnpm db:ci`, and DB-backed `test/integration` specs **cannot be run here**.
- What IS runnable here: `pnpm typecheck`, `pnpm lint`, `pnpm db:lint` (node script),
  `pnpm vitest run test/unit` (pure unit tests with fakes), `pnpm openapi:generate/check`.
- **User runs** all Docker/DB-backed verification + staging/hosted/smoke gates and supplies
  provider secrets (Resend / FCM / Paystack transfers / Sentry DSN).

## Phase 0 — Production connectivity
- [x] T1 docs + .env pooler guidance — commit `0c7dd53`
- [x] T2 db:preflight script — commit `e31f994`
- [x] T3 pg_cron maintenance schedule — commit `351ac33` (db:test deferred to user)
- [x] T4 Sentry error reporting — commits `c65cd94` + `a266107` (lint fix)
- [ ] T5 staging readiness gate — USER (infra: pnpm ci w/ Docker, deploy, hosted E2E, smoke, confirm cron)

Phase 0 local gates green: typecheck, lint, vitest unit (117), db:lint, openapi:generate.

## Phase 1 — Async core
- [x] T1 outbox lifecycle DB fns — `5cbff8b`
- [x] T2 emit order-lifecycle events + notification mapping — `97c3d27`
- [x] T3 worker outbox repo + processor + registry — `d7904c8`
- [x] T4 email channel (Resend) — `7fd6d81`
- [x] T5 push channel (FCM) + device tokens — `9c582f4`
- [x] T6 notification dispatch handler + delivery log + worker wiring — `87246a6`
- [x] T7 enable Supabase Realtime (publication) — `e5f518b`
- [x] T8 order quote via calculateOrderPricing — `d66c89c`

Phase 1 local gates green: typecheck, lint, vitest unit (126), db:lint.
DB-backed (db:reset/db:test/integration) + worker-outbox spec deferred to USER (Docker).

## Phase 2 — Automation
- [x] T1 zone-based delivery fee — `6f88c8b`
- [x] T2 promotions engine — `270b709`
- [x] T3 rider availability flag — `77cf0d5`
- [x] T4 auto rider dispatch — `665f898`
- [x] T5 reconcile TS order-status enum with DB — `f8fcda9`

Phase 2 local gates green: typecheck, lint, vitest unit (138), db:lint, openapi:generate.

## Phase 3 — Money & hardening
- [x] T1 Paystack transfer client methods — `7998a58`
- [x] T2 payout transfers table + reconciliation fn — `6fa6d98`
- [x] T3 gated payout service (PAYOUTS_ENABLED) — `19a84b2`
- [x] T4 transfer webhook reconciliation — `b4acebd`
- [x] T5 asymmetric JWKS verification (HS256 fallback) — `62ff7b7`
- [x] T6 password reset + resend confirmation — `ab34a65`
- [x] T7 remove empty placeholder modules — `20ff555`
- [x] T8 observability + go-live docs — this commit

Phase 3 local gates green: typecheck, lint, vitest unit (147), db:lint, openapi:generate.

## USER/infra remaining (Docker + hosted gates)
- P0-T5: `pnpm db:ci` (Docker), deploy staging, `/v1/health/ready`, `test:e2e:hosted`,
  `smoke:production`, confirm pg_cron firing.
- All DB-backed verification: `pnpm db:reset && pnpm db:test` (pgTAP suites incl. new
  promotions/rider-availability/auto-dispatch/payout transfers), `pnpm db:types`.
- Provider secrets: Resend, FCM, Paystack transfers (+ balance funding), Sentry DSN,
  SUPABASE_JWKS_URL.
- Run `pnpm readiness:launch` in the launch environment; keep `PAYOUTS_ENABLED=false` until a
  controlled enablement.
