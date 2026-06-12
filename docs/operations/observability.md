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

- request count and latency by route;
- 4xx/5xx error rate;
- database pool usage;
- payment initialization failures;
- webhook validation failures and processing delay;
- pending outbox and dead-letter events;
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
- payment webhook backlog;
- database connection exhaustion;
- failed cron or settlement job;
- dead-letter events;
- repeated invalid webhook signatures;
- abnormal refund activity.
