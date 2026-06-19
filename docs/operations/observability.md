# Observability

## Structured Logs

Current request logs include:

- request ID;
- trace ID;
- method;
- route;
- URL;
- response status;
- duration;
- redacted headers.

User ID, role, campus ID, order ID, batch ID, and safe provider references must be added after verified auth context and business endpoints exist.

## Metrics

Current in-process metrics are exposed through `GET /v1/operations/status` for authorized operators:

- request total;
- status-class counts;
- route counts;
- average and max request latency;
- database pool totals.

Required external metrics before launch:

- liveness and readiness success rate;
- request count and latency by route;
- 4xx/5xx error rate;
- database query errors and timeout rate;
- database pool usage;
- payment initialization failures;
- webhook validation failures and processing delay;
- pending outbox and dead-letter events;
- settlement generation and mark-paid failures;
- order creation failures and inventory conflicts;
- late batches and missing riders;
- open escalations;
- refund failures;
- settlement discrepancies.

## Alerts

Configure alerts for:

- API unavailable;
- readiness failure;
- high 5xx rate;
- elevated database error rate;
- payment webhook backlog;
- database connection exhaustion;
- failed cron or settlement job;
- dead-letter events;
- outbox backlog above operating threshold;
- repeated invalid webhook signatures;
- abnormal refund activity.

## Error Reporting (Sentry)

The global exception filter reports unhandled errors through the configured `ErrorReporter`
(`SentryErrorReporter` when `SENTRY_DSN` is set, otherwise a no-op). Handled `HttpException`
responses are not reported.

Production configuration:

- `SENTRY_DSN` — set in production secret management; absence disables reporting (no-op).
- `SENTRY_ENVIRONMENT` — set to `production` / `staging` so issues are environment-tagged.
- `SENTRY_TRACES_SAMPLE_RATE` — start at a low rate (e.g. `0.1`) and tune.
- Release tagging — tag each deploy with `RELEASE_VERSION` / `COMMIT_SHA` so regressions map to a
  specific release.

Alert thresholds (route to the production incident owner):

- Error rate — page when the unhandled error rate exceeds the agreed baseline over a 5-minute
  window.
- `/v1/health/ready` downtime — page on any readiness failure sustained beyond one probe interval.
- Worker dead-letter count — alert when `outbox_events` rows with a non-null `failed_at`
  (attempts at `WORKER_MAX_ATTEMPTS`) accumulate above the operating threshold.

## Launch Monitoring Checklist

- Dashboards show API availability, p95 latency, 5xx rate, database errors, and pool saturation.
- Payment panels show initialization failures, webhook rejection count, duplicate webhook count, and processing lag.
- Operations panels show outbox available/locked/failed counts, settlement failures, and open escalations.
- Alerts route to the production incident owner before production traffic is enabled.
