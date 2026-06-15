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

## Launch Monitoring Checklist

- Dashboards show API availability, p95 latency, 5xx rate, database errors, and pool saturation.
- Payment panels show initialization failures, webhook rejection count, duplicate webhook count, and processing lag.
- Operations panels show outbox available/locked/failed counts, settlement failures, and open escalations.
- Alerts route to the production incident owner before production traffic is enabled.
