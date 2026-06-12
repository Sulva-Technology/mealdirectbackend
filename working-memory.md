# Working Memory

## Problem Summary

Meal Direct backend is being built from API foundation into production-hardened service. Current request applied PROD-01 through PROD-05 hardening prompts as executable foundations, CI/deployment scaffolding, security documentation, observability, and launch audit.

## Stack and Runtime

- Node.js 24 target.
- NestJS 11 with Fastify.
- TypeScript, Vitest, ESLint, Prettier.
- PostgreSQL/Supabase migrations and pgTAP database tests.
- Render deployment target.

## Confirmed Facts

- API currently has health and protected operations endpoints.
- Business modules exist mostly as module shells; full order/payment/vendor/rider/admin API flows are not implemented yet.
- Database migrations include core schema, RLS, order/payment/batch/settlement functions, and seed data.
- Local machine lacks Supabase CLI/Docker, so full database CI could not be run locally.

## Current Contracts

- `GET /v1/health/live`
- `GET /v1/health/ready`
- `GET /v1/operations/status` protected by `INTERNAL_OPERATIONS_TOKEN`
- OpenAPI artifacts in `docs/openapi.json` and `docs/openapi.yaml`

## Remaining Launch Blockers

- Supabase JWT verification in API.
- RBAC and object-level authorization in business routes.
- Paystack initialization and webhook signature/replay/idempotency handling.
- API order creation through transactional inventory reservation.
- Vendor/rider/admin/customer endpoint flows and E2E tests.
- External observability/alerting provider configuration.
- Full `pnpm db:ci` verification with Supabase CLI and Docker.
