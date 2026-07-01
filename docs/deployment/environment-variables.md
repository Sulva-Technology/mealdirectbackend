# Environment Variable Reference

Do not commit real values. Store staging and production values only in platform secret management.

| Variable                           | Environments        | Secret | Purpose                                                                            |
| ---------------------------------- | ------------------- | ------ | ---------------------------------------------------------------------------------- |
| `NODE_ENV`                         | all                 | no     | `development`, `test`, `staging`, or `production`                                  |
| `APP_NAME`                         | all                 | no     | Service display name                                                               |
| `HOST`                             | local, Render       | no     | API bind host, `0.0.0.0` on Render                                                 |
| `PORT`                             | all                 | no     | API port; Render provides this at runtime                                          |
| `API_PREFIX`                       | all                 | no     | API prefix, default `v1`                                                           |
| `DATABASE_URL`                     | all                 | yes    | PostgreSQL connection string                                                       |
| `DATABASE_SSL`                     | all                 | no     | Must be `true` outside local/test                                                  |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | all                 | no     | Set `false` only for managed poolers that fail strict certificate-chain validation |
| `DATABASE_POOL_MAX`                | all                 | no     | PostgreSQL pool size                                                               |
| `SUPABASE_URL`                     | all                 | no     | Supabase project URL                                                               |
| `SUPABASE_JWT_ISSUER`              | all                 | no     | Supabase JWT issuer                                                                |
| `SUPABASE_JWT_AUDIENCE`            | all                 | no     | Expected JWT audience                                                              |
| `SUPABASE_JWT_SECRET`              | all                 | yes    | Supabase HS256 JWT signing secret                                                  |
| `CORS_ALLOWED_ORIGINS`             | all                 | no     | Exact comma-separated frontend origins                                             |
| `LOG_LEVEL`                        | all                 | no     | `silent`, `debug`, `info`, `warn`, or `error`                                      |
| `BODY_LIMIT_BYTES`                 | all                 | no     | Fastify payload limit                                                              |
| `RATE_LIMIT_MAX`                   | all                 | no     | Window request limit                                                               |
| `RATE_LIMIT_WINDOW_MS`             | all                 | no     | Rate limit window                                                                  |
| `REQUEST_ID_HEADER`                | all                 | no     | Request ID header name                                                             |
| `TRACE_ID_HEADER`                  | all                 | no     | Trace ID header name                                                               |
| `RELEASE_VERSION`                  | staging, production | no     | Release identifier                                                                 |
| `COMMIT_SHA`                       | staging, production | no     | Deployed commit SHA                                                                |
| `RESERVATION_TTL_SECONDS`          | all                 | no     | Inventory reservation TTL                                                          |
| `PAYSTACK_BASE_URL`                | all                 | no     | Paystack API base URL; must be `https://api.paystack.co` in production             |
| `PAYSTACK_SECRET_KEY`              | staging, production | yes    | Paystack secret key                                                                |
| `PAYSTACK_WEBHOOK_INBOX_MODE`      | all                 | no     | `database` outside test                                                            |
| `INTERNAL_OPERATIONS_TOKEN`        | staging, production | yes    | Temporary operations endpoint token                                                |
| `FCM_PROJECT_ID`                   | staging, production | yes    | Firebase project ID for FCM push delivery                                          |
| `FCM_CLIENT_EMAIL`                 | staging, production | yes    | Firebase service-account client email for FCM                                      |
| `FCM_PRIVATE_KEY`                  | staging, production | yes    | Firebase service-account private key for FCM; encode newlines as `\n`              |
| `E2E_DATABASE_URL`                 | E2E only            | yes    | Dedicated hosted Supabase E2E database URL; must match `DATABASE_URL` in E2E       |
| `E2E_TEST_NAMESPACE`               | E2E only            | no     | Safe namespace prefix such as `e2e_meal_direct_<run_id>`                           |
| `PRODUCTION_API_BASE_URL`          | smoke only          | no     | Production API URL used by `pnpm smoke:production`                                 |
| `SMOKE_FRONTEND_ORIGINS`           | smoke only          | no     | Optional frontend origin override for smoke checks                                 |

Staging and production must use different Supabase projects, database credentials, Paystack keys, operations tokens, and frontend origins.

Hosted E2E must use a third isolated Supabase project or a staging project that can be safely mutated. Never point `pnpm test:e2e:hosted` at `.env.production`; use `pnpm smoke:production` for production, which performs read-only checks plus unsigned-webhook rejection.

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
