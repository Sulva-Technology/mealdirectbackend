# Operations Runbooks

## Paystack Outage

1. Confirm Paystack status and webhook delay.
2. Disable payment initialization if duplicate charging risk exists.
3. Keep unpaid orders in pending state and do not reserve inventory beyond TTL.
4. Replay verified webhook events after recovery.
5. Reconcile successful charges against local payments and refunds.

## Supabase Outage

1. Confirm API readiness failures and Supabase dashboard status.
2. Pause deployments and migrations.
3. Keep API serving liveness but fail readiness.
4. After recovery, run smoke tests and settlement consistency checks.

## Render Outage

1. Confirm web, worker, and cron service health.
2. Pause production release jobs.
3. Use Render rollback only after confirming schema compatibility.
4. Run post-recovery smoke tests for all frontend origins.

## Failed Payment Webhook

1. Verify signature and event reference.
2. Check `payment_events` for duplicate or failed processing.
3. Compare Paystack transaction state with the local `payments` row.
4. Reprocess only idempotently through the verified webhook/reconciliation path.
5. Confirm `orders.order_status`, `payments.status`, and any outbox events agree.

## Duplicate Payment

1. Confirm duplicate Paystack references and local payment rows.
2. Prevent additional webhook effects with idempotency key/event uniqueness.
3. Refund only through approved refund workflow.
4. Record audit log and customer support note.

## Oversold Inventory

1. Identify affected menu item, slot, and orders.
2. Stop further ordering for the item/slot.
3. Use reservation and inventory adjustment history to find source.
4. Contact affected customers and vendors.
5. Patch the transactional reservation path before reopening.

## Stuck Order

1. Inspect order status history.
2. Identify missing transition owner: vendor, rider, customer, payment, or admin.
3. Apply only allowed transitions.
4. Record audit entry for any admin correction.

## Missing Rider

1. Check batch status and rider assignments.
2. Notify Campus Admin and vendor.
3. Reassign or cancel using allowed transition path.
4. Track impact in late batch metrics.

## Failed Refund

1. Confirm Paystack refund state.
2. Ensure local refund is not duplicated.
3. Retry only with idempotency.
4. Keep settlement lines traceable to refund outcome.

## Incorrect Settlement

1. Freeze payout approval for affected vendor/rider.
2. Recompute from settled orders, delivery assignments, refunds, and adjustments.
3. Create correction lines, never edit immutable historical records.
4. Obtain finance approval before payout.

## Stuck Outbox Events

1. Check `/v1/admin/jobs/outbox?status=available` and `status=locked`.
2. Identify events with stale `locked_at` or repeated `last_error`.
3. Confirm the worker is running and has database connectivity.
4. Release or retry only events whose handler is idempotent.
5. Track backlog count until it returns to the normal operating range.

## Readiness Failure

1. Check `/v1/health/live`; if live fails, treat as API outage.
2. Check `/v1/health/ready` and sanitized `HealthController` database error logs.
3. Verify Supabase connection string, SSL flags, pooler status, and credentials.
4. Keep deployments paused while readiness is failing.
5. Run `pnpm smoke:production` after recovery.

## Settlement Correction

1. Freeze the affected settlement before mark-paid.
2. Add an adjustment through the admin settlement adjustment endpoint.
3. Include a human-readable description that references the incident/support ticket.
4. Re-run settlement detail and audit-log checks before payout.
5. Do not edit historical settlement lines directly.

## Compromised Admin Account

1. Disable the admin membership and revoke sessions.
2. Rotate secrets if privilege misuse could expose them.
3. Review audit logs for admin actions.
4. Notify affected stakeholders.

## Leaked Secret

1. Revoke and rotate the secret immediately.
2. Search logs and CI artifacts for exposure.
3. Redeploy affected services.
4. Open an incident record and complete post-incident review.
