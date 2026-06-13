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
| `PAYSTACK_SECRET_KEY`              | staging, production | yes    | Paystack secret key                                                                |
| `PAYSTACK_WEBHOOK_INBOX_MODE`      | all                 | no     | `database` outside test                                                            |
| `INTERNAL_OPERATIONS_TOKEN`        | staging, production | yes    | Temporary operations endpoint token                                                |

Staging and production must use different Supabase projects, database credentials, Paystack keys, operations tokens, and frontend origins.
