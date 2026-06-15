# Working Memory

## Problem Summary

Meal Direct backend is being built from API foundation into production-hardened service. Current work added protected order creation, database-backed Paystack webhook handling, Super Admin settlement generation endpoints, Render/pnpm build stabilization, CI/deployment scaffolding, security documentation, observability, and launch audit updates.

## Stack and Runtime

- Node.js 24 target.
- NestJS 11 with Fastify.
- TypeScript, Vitest, ESLint, Prettier.
- PostgreSQL/Supabase migrations and pgTAP database tests.
- Render deployment target.

## Confirmed Facts

- API currently has health, authenticated `/auth/me`, customer order creation, Paystack webhook, Super Admin settlement generation, and protected operations endpoints.
- Business modules have initial order/payment/settlement surfaces; full vendor/rider/admin/customer product flows are not implemented yet.
- Database migrations include core schema, RLS, order/payment/batch/settlement functions, and seed data.
- Local machine lacks Supabase CLI/Docker, so full database CI could not be run locally.
- Render Docker install failure from pnpm minimum release age was addressed by declaring `packageManager: pnpm@10.24.0`, overriding `esbuild` to `0.28.0`, and regenerating `pnpm-lock.yaml`.
- Live Render smoke test on 2026-06-13 showed `/v1/health/live`, `/docs`, OpenAPI, and unauthenticated guard failures working, but `/v1/health/ready` returned `DATABASE_UNAVAILABLE`.
- Redacted database diagnostics against the Supabase pooler showed current strict TLS verification fails with `SELF_SIGNED_CERT_IN_CHAIN`; relaxing certificate-chain validation reaches Postgres but the available local production URL then fails password authentication.
- CORS disallowed-origin preflight previously surfaced as a 500; the app now disables CORS for disallowed origins instead of raising a server error.
- Render logs confirmed `/v1/health/ready` failed with `SELF_SIGNED_CERT_IN_CHAIN`. `pg-connection-string` treats `sslmode=require` as strict verification by default, so `DatabaseService` now applies `{ rejectUnauthorized: false }` whenever `DATABASE_SSL=true` and `DATABASE_SSL_REJECT_UNAUTHORIZED=false`, even if `DATABASE_URL` includes `sslmode`.
- Readiness failures now log sanitized database error metadata under `HealthController` before returning the unchanged public `DATABASE_UNAVAILABLE` response.

## Current Contracts

- `GET /v1/health/live`
- `GET /v1/health/ready`
- `GET /v1/auth/me` protected by Supabase JWT
- `POST /v1/orders` protected by Supabase JWT, customer role, and `Idempotency-Key`
- `POST /v1/payments/webhooks/paystack` protected by Paystack HMAC signature, with database-backed event inbox outside test mode
- `POST /v1/settlements/vendors/:vendorId/daily` protected by Supabase JWT and `super_admin` role
- `POST /v1/settlements/riders/:riderId/daily` protected by Supabase JWT and `super_admin` role
- `GET /v1/operations/status` protected by `INTERNAL_OPERATIONS_TOKEN`
- OpenAPI artifacts in `docs/openapi.json` and `docs/openapi.yaml`

## Remaining Launch Blockers

- Applying Supabase JWT/RBAC guards to all business routes.
- Object-level authorization in business routes.
- Paystack initialization and refund workflow.
- Live database verification for order reservation, payment webhook side effects, and settlement generation.
- Remaining vendor/rider/admin/customer endpoint flows and E2E tests.
- External observability/alerting provider configuration.
- Full `pnpm db:ci` verification with Supabase CLI and Docker.
- After the next Render deploy, check `/v1/health/ready`; if it still fails, inspect Render logs for the sanitized `HealthController` database error code/message.
