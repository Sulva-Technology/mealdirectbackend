# Meal Direct Backend

This repository contains the Meal Direct Node.js backend and production PostgreSQL schema. The API is a NestJS modular monolith using Fastify, Kysely, Supabase Auth/JWT assumptions, structured JSON logging, validation, rate limiting, CORS/helmet hardening, health checks, and generated OpenAPI docs.

The database is managed with Supabase CLI migrations only. It is scoped for the Venite University pilot while keeping campus, zone, role, and settlement records ready for multi-campus expansion.

## Prerequisites

- Node.js 24 or newer
- pnpm 9 or newer
- Docker Desktop
- Supabase CLI

## API Setup

```bash
pnpm install
Copy-Item .env.example .env.development
pnpm dev
```

The API listens on `PORT` from the environment, defaulting to `4000`, and exposes:

- `GET /v1/health/live`
- `GET /v1/health/ready`
- Swagger UI at `/docs`
- OpenAPI JSON at `/docs/openapi.json`

Generate static OpenAPI artifacts with:

```bash
pnpm openapi:generate
```

The generated files are written to `docs/openapi.json` and `docs/openapi.yaml`.

## API Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm openapi:generate
```

Production database gate tests require a disposable PostgreSQL database and do not mock persistence:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:production
```

## Production Hardening Artifacts

- [Security policy](SECURITY.md)
- [Threat model](docs/security/threat-model.md)
- [Risk register](docs/security/risk-register.md)
- [Observability plan](docs/operations/observability.md)
- [Operations runbooks](docs/operations/runbooks.md)
- [Release checklist](docs/deployment/release-checklist.md)
- [Rollback runbook](docs/deployment/rollback-runbook.md)
- [Environment variable reference](docs/deployment/environment-variables.md)
- [Promotion guide](docs/deployment/promotion-guide.md)
- [Launch readiness audit](docs/launch-readiness-audit.md)
- [Go-live checklist](docs/go-live-checklist.md)
- k6 load profile: `load/k6/campus-load.js`

## Database Setup

```bash
pnpm install
pnpm supabase:start
pnpm db:reset
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm db:status
```

`supabase/config.toml` disables Google OAuth locally so no OAuth secret is committed. Configure Google OAuth in each Supabase environment using project secrets or the dashboard provider settings.

## Migration Workflow

All schema changes live in `supabase/migrations` and use the format `YYYYMMDDHHMMSS_snake_case.sql`. Create migrations with:

```bash
supabase migration new descriptive_name
```

Do not use ORM migrations, manual remote SQL edits, or dashboard-only schema changes. Financial, audit, payment, settlement, status-history, and inventory-adjustment records are append-only or protected from destructive deletion.

## Reset and Seed

`pnpm db:reset` rebuilds the local database from migrations and loads `supabase/seed.sql`. The seed file contains fictional Venite University data, fake local auth identities, sample vendors, schedules, inventory, orders, delivery records, and settlement examples.

## Tests

Database tests live in `supabase/tests/database` and run with:

```bash
pnpm db:test
```

The tests cover schema presence, constraints, inventory accounting, order totals, cutoffs, idempotency, payment deduplication, RLS boundaries, append-only history, settlement arithmetic, review eligibility, and escalation lifecycle.

## Types

Generate TypeScript types for the Node/TypeScript backend and Next.js frontends:

```bash
pnpm db:types
```

The generated file is written to `supabase/types/database.types.ts`.

## Staging and Production Linking

Link each remote project explicitly:

```bash
supabase link --project-ref <staging-project-ref>
supabase migration list
supabase db push --dry-run
```

Repeat with the production project only after staging has passed reset, pgTAP, lint, type generation, and application smoke tests.

## Safe Deployment

1. Create a migration locally.
2. Run `pnpm db:reset`.
3. Run `pnpm db:test`.
4. Run `pnpm db:lint`.
5. Run `pnpm db:types`.
6. Run `pnpm db:diff:check`.
7. Review the SQL diff in pull request.
8. Deploy to staging.
9. Promote to production after application verification.

## Rollback Guidance

Supabase migrations are forward-oriented. To reverse a production change, create a new forward migration that restores the previous behavior or archives newly created data. Do not edit historical migrations after they have been merged.

## Conflict Resolution

When two branches create migrations with conflicting timestamps or overlapping objects, keep both files, rename only the unmerged branch's new migration timestamp if needed, re-run `pnpm db:reset`, and review the generated schema diff before merging.

## Security Notes

No service-role key, database URL, Paystack secret, OAuth client secret, or real banking data belongs in this repository. Payout records store Paystack recipient codes and masked account-number snapshots only.
