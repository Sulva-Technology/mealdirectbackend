# Release Checklist

## Pre-Merge

- `pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm test:no-skips`
- `pnpm openapi:check`
- `pnpm db:reset`
- `pnpm db:test`
- `pnpm test:production`
- `pnpm test:e2e:hosted`
- `pnpm db:lint`
- `pnpm db:types`
- `pnpm db:diff:check`
- `pnpm audit --audit-level high`
- `pnpm smoke:production`
- `docker build -t meal-direct-api:<commit> .`

## Staging

1. Run migrations against staging once from CI or an operator terminal.
2. Deploy API, worker, and cron services to staging.
3. Run smoke tests for:
   - user frontend;
   - vendor frontend;
   - rider frontend;
   - admin frontend.
4. Verify `/v1/health/live`, `/v1/health/ready`, `/docs/openapi.json`, and `/v1/operations/status`.
5. Run `pnpm test:e2e:hosted` against the dedicated hosted E2E/staging Supabase project.
6. Confirm release version and commit SHA in health metadata.

## Production

1. Obtain manual approval from engineering and operations owners.
2. Confirm rollback/roll-forward path is compatible with the migrated schema.
3. Run production migrations once, separately from API startup.
4. Deploy API and worker after migration success.
5. Confirm cron jobs are enabled only after the API is healthy.
6. Run post-deployment smoke tests.
7. Run `pnpm smoke:production`; do not run hosted E2E against production.
8. Monitor logs, readiness, Paystack webhooks, database pool, outbox backlog, settlement jobs, and error rates.

## Production Supabase Safety

- Production and hosted E2E must use separate Supabase projects.
- Production migrations run once from a controlled release process.
- Hosted E2E may seed and clean test data; production smoke must remain read-only.
- Cron and worker-dependent operations are enabled only after readiness and production smoke pass.

## Migration Safety

- Prefer expand-and-contract migrations.
- Add nullable columns or backward-compatible objects before code depends on them.
- Backfill data in bounded jobs.
- Deploy code that reads both old and new shape when needed.
- Remove old columns only in a later release after verification.
