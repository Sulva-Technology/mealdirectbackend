# Phase 0 — Production Connectivity & Launch Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed backend reliably reach its database, schedule the existing maintenance jobs in-database, report errors to Sentry, and prove the verification harness passes end-to-end against a real staging project.

**Architecture:** The SSL pool config already supports relaxed certificate validation for the Supabase pooler (`createPostgresPoolConfig`); the outstanding production failure is a connection-string/credentials (pooler) issue, so Phase 0 is mostly correct configuration plus diagnostics, in-DB scheduling via pg_cron, and an error-reporting hook in the existing global exception filter. No business-logic changes.

**Tech Stack:** NestJS 11 + Fastify, Kysely + `pg`, Supabase (Postgres 15) + pg_cron, Vitest, pgTAP, `@sentry/node`.

**Spec:** `docs/superpowers/specs/2026-06-18-production-readiness-design.md` (Phase 0).

---

## File Structure

- `docs/deployment/environment-variables.md` — add the canonical Supabase pooler connection guidance (modify).
- `.env.production.example` — add/confirm `DATABASE_URL` pooler shape + SSL + Sentry vars (modify).
- `scripts/db-preflight.ts` — standalone connectivity diagnostic reusing the app pool config (create).
- `package.json` — add `db:preflight` script (modify).
- `supabase/migrations/<ts>_schedule_maintenance_cron.sql` — enable pg_cron + schedule the two jobs (create).
- `supabase/tests/database/cron_schedule_test.sql` — pgTAP assertion the jobs are scheduled (create).
- `src/config/env.ts` — add optional Sentry env vars (modify).
- `src/common/observability/error-reporter.ts` — `ErrorReporter` interface + Sentry + no-op impls (create).
- `src/common/filters/http-exception.filter.ts` — report unhandled (non-HTTP/5xx) errors (modify).
- `src/app.factory.ts` — build the reporter from env and pass it to the filter (modify).
- `test/unit/error-reporter.spec.ts` — reporter selection + filter reporting behavior (create).

---

## Task 1: Document the production database connection (config + docs)

This task is configuration only — no code. The pool layer already strips `sslmode` and relaxes
cert validation; the production `DATABASE_UNAVAILABLE` was a pooler credential/host issue.

**Files:**

- Modify: `docs/deployment/environment-variables.md`
- Modify: `.env.production.example`

- [ ] **Step 1: Add the canonical connection guidance to the deployment docs**

Append a section to `docs/deployment/environment-variables.md`:

```markdown
## Supabase database connection (production/staging)

Use the **Session pooler** connection string from Supabase →
Project Settings → Database → Connection string → "Session pooler":
```

DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=10

```

Notes:
- The username MUST include the project ref suffix (`postgres.<project-ref>`); a bare
  `postgres` username fails password auth against the pooler.
- Do not append `?sslmode=...`; the app supplies an explicit SSL object and strips
  `sslmode` from the URL (see `createPostgresPoolConfig`).
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` avoids `SELF_SIGNED_CERT_IN_CHAIN` against the
  pooler chain while keeping TLS in transit.
```

- [ ] **Step 2: Mirror the variables in `.env.production.example`**

Ensure `.env.production.example` contains (add if missing, keep placeholder values):

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=10
```

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/environment-variables.md .env.production.example
git commit -m "docs: pin Supabase pooler connection guidance for production"
```

---

## Task 2: Database preflight diagnostic script

A runnable script that connects with the exact app pool config and prints sanitized
diagnostics, so connectivity can be verified in CI or a Render shell before serving traffic.

**Files:**

- Create: `scripts/db-preflight.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the preflight script**

```ts
// scripts/db-preflight.ts
import { Pool } from 'pg';

import { createPostgresPoolConfig } from '../src/database/database.service.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';

function sanitize(message: string): string {
  return message
    .replace(/:\/\/[^:\s/@]+:[^@\s/]+@/g, '://[REDACTED]@')
    .replace(/password\s+"[^"]+"/gi, 'password "[REDACTED]"');
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const env = parseEnvironment();
  const pool = new Pool(createPostgresPoolConfig(env));
  try {
    const startedAt = Date.now();
    await pool.query('select 1 as ok');
    process.stdout.write(
      JSON.stringify({ status: 'ok', latencyMs: Date.now() - startedAt }) + '\n'
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown preflight failure';
  const code = (error as { code?: string }).code;
  process.stderr.write(
    JSON.stringify({ status: 'error', code, message: sanitize(message) }) + '\n'
  );
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
"db:preflight": "tsx scripts/db-preflight.ts",
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Verify it runs against the local DB**

Run (with Supabase running locally):
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:preflight`
Expected: stdout line `{"status":"ok","latencyMs":<n>}` and exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/db-preflight.ts package.json
git commit -m "feat: add database preflight connectivity script"
```

---

## Task 3: Schedule maintenance jobs with pg_cron

Move the two SQL maintenance jobs into the database so they fire on a schedule without an
external trigger. (`release_expired_reservations` and `close_batches_at_cutoff` already exist.)

**Files:**

- Create: `supabase/migrations/<timestamp>_schedule_maintenance_cron.sql`
- Create: `supabase/tests/database/cron_schedule_test.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/<timestamp>_schedule_maintenance_cron.sql` (use
`supabase migration new schedule_maintenance_cron` to get the timestamp):

```sql
begin;

create extension if not exists pg_cron with schema extensions;

-- Named schedules upsert by job name, so reruns are idempotent.
select cron.schedule(
  'release-expired-reservations',
  '*/5 * * * *',
  $$ select public.release_expired_reservations(); $$
);

select cron.schedule(
  'close-batches-at-cutoff',
  '* * * * *',
  $$ select public.close_batches_at_cutoff(); $$
);

commit;
```

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/database/cron_schedule_test.sql`:

```sql
begin;
select plan(2);

select ok(
  exists (select 1 from cron.job where jobname = 'release-expired-reservations'),
  'release-expired-reservations cron job is scheduled'
);

select ok(
  exists (select 1 from cron.job where jobname = 'close-batches-at-cutoff'),
  'close-batches-at-cutoff cron job is scheduled'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Reset the DB and run db tests**

Run: `pnpm db:reset && pnpm db:test`
Expected: pgTAP reports the two cron assertions passing. If `create extension pg_cron`
fails locally, confirm the Supabase CLI Postgres image includes pg_cron (it does for
`supabase/postgres`); do not stub it.

- [ ] **Step 4: Lint migrations**

Run: `pnpm db:lint`
Expected: PASS (no TODO/FIXME/placeholder; valid SQL).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/cron_schedule_test.sql
git commit -m "feat(db): schedule maintenance jobs via pg_cron"
```

---

## Task 4: Sentry error reporting in the global exception filter

Report unhandled errors (the non-`HttpException` 5xx branch) to Sentry when a DSN is
configured; no-op otherwise. Keep it injectable so it is unit-testable.

**Files:**

- Modify: `src/config/env.ts`
- Create: `src/common/observability/error-reporter.ts`
- Modify: `src/common/filters/http-exception.filter.ts`
- Modify: `src/app.factory.ts`
- Create: `test/unit/error-reporter.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/error-reporter.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter.js';
import { NoopErrorReporter } from '../../src/common/observability/error-reporter.js';
import type { ErrorReporter } from '../../src/common/observability/error-reporter.js';
import { JsonLogger } from '../../src/common/logging/json-logger.service.js';

function fakeHost(): ArgumentsHost {
  const reply = { status: () => reply, send: () => reply } as unknown;
  const request = { headers: {}, id: 'req-1' } as unknown;
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request
    })
  } as ArgumentsHost;
}

describe('GlobalExceptionFilter error reporting', () => {
  it('reports unhandled non-HTTP errors to the reporter', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(new JsonLogger(), reporter);

    filter.catch(new Error('boom'), fakeHost());

    expect(reporter.captureException).toHaveBeenCalledTimes(1);
  });

  it('does not report handled HttpExceptions', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(new JsonLogger(), reporter);

    filter.catch(new HttpException('nope', HttpStatus.BAD_REQUEST), fakeHost());

    expect(reporter.captureException).not.toHaveBeenCalled();
  });

  it('NoopErrorReporter is safe to call', () => {
    expect(() => new NoopErrorReporter().captureException(new Error('x'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/error-reporter.spec.ts`
Expected: FAIL — `error-reporter.js` does not exist and the filter constructor takes one arg.

- [ ] **Step 3: Create the ErrorReporter**

Create `src/common/observability/error-reporter.ts`:

```ts
export interface ErrorReporter {
  captureException(error: unknown): void;
}

export class NoopErrorReporter implements ErrorReporter {
  captureException(): void {
    // Intentionally does nothing when Sentry is not configured.
  }
}

export class SentryErrorReporter implements ErrorReporter {
  constructor(private readonly client: { captureException: (error: unknown) => unknown }) {}

  captureException(error: unknown): void {
    this.client.captureException(error);
  }
}
```

- [ ] **Step 4: Update the filter to accept and use the reporter**

In `src/common/filters/http-exception.filter.ts`, add the import:

```ts
import { NoopErrorReporter, type ErrorReporter } from '../observability/error-reporter.js';
```

Change the constructor and the unhandled branch:

```ts
  constructor(
    private readonly logger: JsonLogger,
    private readonly reporter: ErrorReporter = new NoopErrorReporter()
  ) {}
```

Immediately before the existing `this.logger.error(` call in the non-`HttpException`
branch, add:

```ts
this.reporter.captureException(exception);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/error-reporter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Add Sentry env vars**

In `src/config/env.ts`, inside the `z.object({ ... })`, add after `INTERNAL_OPERATIONS_TOKEN`:

```ts
    SENTRY_DSN: optionalSecret,
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
```

- [ ] **Step 7: Wire Sentry into bootstrap**

Install the dependency:

```bash
pnpm add @sentry/node
```

In `src/app.factory.ts`, add imports:

```ts
import * as Sentry from '@sentry/node';
import {
  NoopErrorReporter,
  SentryErrorReporter,
  type ErrorReporter
} from './common/observability/error-reporter.js';
```

Add a helper above `configureGlobals`:

```ts
function createErrorReporter(config: AppEnvironment): ErrorReporter {
  if (config.SENTRY_DSN === undefined) {
    return new NoopErrorReporter();
  }
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    release: config.RELEASE_VERSION
  });
  return new SentryErrorReporter(Sentry);
}
```

Change `configureGlobals` to take and use the reporter:

```ts
function configureGlobals(app: INestApplication, reporter: ErrorReporter): void {
  const logger = app.get(JsonLogger);
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter(logger, reporter));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
}
```

In `createApp`, replace `configureGlobals(app);` with:

```ts
configureGlobals(app, createErrorReporter(config));
```

- [ ] **Step 8: Run the full unit + typecheck gate**

Run: `pnpm typecheck && pnpm vitest run test/unit`
Expected: PASS (including the new error-reporter spec; no type errors).

- [ ] **Step 9: Commit**

```bash
git add src/config/env.ts src/common/observability/error-reporter.ts \
  src/common/filters/http-exception.filter.ts src/app.factory.ts \
  test/unit/error-reporter.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(observability): report unhandled errors to Sentry"
```

---

## Task 5: Run the readiness gate against staging

Verification only — proves Phase 0 succeeded. Requires staging Supabase + `.env.e2e` and
production smoke secrets configured per the spec.

**Files:** none (execution + verification).

- [ ] **Step 1: Full local CI**

Run: `pnpm ci`
Expected: format, lint, typecheck, coverage, no-skips, OpenAPI check, and `db:ci`
(reset + pgTAP incl. the new cron test + lint + types + diff) all PASS.

- [ ] **Step 2: Deploy to staging, then verify connectivity**

After deploying with the Task 1 env values, run against the staging URL:
`curl -fsS https://<staging-host>/v1/health/ready`
Expected: HTTP 200 with `"database":{"status":"ok",...}`. If 503, run `pnpm db:preflight`
in the staging shell and read the sanitized `code`/`message`.

- [ ] **Step 3: Hosted E2E + production smoke**

Run: `pnpm test:e2e:hosted` then `pnpm smoke:production`
Expected: both PASS (smoke is read-only).

- [ ] **Step 4: Confirm cron is firing**

In staging SQL, run: `select jobname, last_run_status from cron.job_run_details order by start_time desc limit 5;`
Expected: recent successful runs for both job names.

- [ ] **Step 5: Tag the phase complete**

```bash
git commit --allow-empty -m "chore: Phase 0 production connectivity verified on staging"
```

---

## Self-Review

- **Spec coverage (Phase 0):** DB connectivity fix → Tasks 1–2; pg_cron scheduling → Task 3;
  Sentry baseline + alerting hook → Task 4 (uptime alerting on `/health/ready` is configured
  in the hosting/monitoring dashboard, noted in Task 5 Step 2); `db:ci` + hosted E2E + smoke
  gates → Task 5. Covered.
- **Placeholder scan:** `<project-ref>`, `<region>`, `<timestamp>`, `<staging-host>` are
  intentional fill-ins for environment-specific secrets/IDs, not code placeholders. All code
  steps contain complete code.
- **Type consistency:** `ErrorReporter.captureException(error: unknown): void`,
  `GlobalExceptionFilter(logger, reporter)`, `createErrorReporter(config)` used consistently
  across the filter, factory, and tests.
