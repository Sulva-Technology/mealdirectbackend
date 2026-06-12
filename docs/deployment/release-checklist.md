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
- `pnpm db:lint`
- `pnpm db:types`
- `pnpm db:diff:check`
- `pnpm audit --audit-level high`
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
5. Confirm release version and commit SHA in health metadata.

## Production

1. Obtain manual approval from engineering and operations owners.
2. Confirm rollback/roll-forward path is compatible with the migrated schema.
3. Run production migrations once, separately from API startup.
4. Deploy API and worker after migration success.
5. Confirm cron jobs are enabled only after the API is healthy.
6. Run post-deployment smoke tests.
7. Monitor logs, readiness, Paystack webhooks, database pool, and error rates.

## Migration Safety

- Prefer expand-and-contract migrations.
- Add nullable columns or backward-compatible objects before code depends on them.
- Backfill data in bounded jobs.
- Deploy code that reads both old and new shape when needed.
- Remove old columns only in a later release after verification.
