# Rollback and Roll-Forward Runbook

## Principles

- Database migrations are forward-only after production deployment.
- Do not edit historical migrations.
- Do not let API instances run migrations at startup.
- Prefer roll-forward fixes when schema has changed.

## API-Only Rollback

1. Confirm the previous API version is schema-compatible.
2. Use Render rollback for the web service and worker.
3. Keep cron jobs disabled until the previous version is healthy.
4. Run smoke tests.
5. Monitor readiness, 5xx rate, payment events, and order mutations.

## Schema-Affecting Failure

1. Stop additional production deployments.
2. Disable affected mutation endpoints or cron jobs.
3. Create a forward repair migration.
4. Apply repair migration once.
5. Deploy compatible code.
6. Reconcile data using audit, status history, payment events, inventory adjustments, and settlement lines.

## Production Data Correction

1. Identify affected rows and immutable history records.
2. Create compensating adjustment records instead of editing financial history.
3. Review with finance/operations owner.
4. Record evidence and affected order/payment/settlement IDs.
