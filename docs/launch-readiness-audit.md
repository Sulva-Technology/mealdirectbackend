# Launch Readiness Audit

Overall status: BLOCKED PENDING LIVE VERIFICATION.

The backend modules and readiness harness now cover authenticated identity, customer, vendor, rider, admin, payment, settlement, notification, and outbox surfaces. The product still cannot be declared production-ready until hosted Supabase E2E, production smoke, `pnpm db:ci`, external monitoring, and launch operations checks pass.

| Area                       | Status           | Evidence                                                                                                                   | Remaining Action                                              | Owner      | Severity |
| -------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- | -------- |
| Business-rule completeness | CONDITIONAL PASS | Domain rule unit tests exist for pricing, cutoffs, status, earnings, settlements, refunds, auth decisions, payment mapping | Wire rules into real API handlers                             | Backend    | High     |
| Database integrity         | CONDITIONAL PASS | Supabase migrations define constraints, immutable history, functions, RLS                                                  | Run full `pnpm db:ci` with Supabase/Docker                    | Backend    | Medium   |
| Migration repeatability    | CONDITIONAL PASS | SQL migrations and seed exist                                                                                              | Verify reset in CI/local with Supabase CLI                    | DevOps     | Medium   |
| RLS                        | CONDITIONAL PASS | RLS migration and pgTAP tests exist                                                                                        | Run production DB gate tests                                  | Backend    | High     |
| RBAC                       | CONDITIONAL PASS | `RolesGuard`, `@RequireRoles`, access matrix, DB functions, and role-specific API tests exist                              | Pass hosted E2E role and denial paths                         | Backend    | Critical |
| Authentication             | CONDITIONAL PASS | Supabase HS256 JWT verification, actor context, and protected route tests exist                                            | Pass hosted E2E with Supabase JWT signing                     | Backend    | Critical |
| Object-level authorization | CONDITIONAL PASS | Route scoping and cross-scope denial paths exist                                                                           | Pass hosted E2E against real Supabase data                    | Backend    | Critical |
| Payment integrity          | CONDITIONAL PASS | Paystack init, webhook, refund, and production URL guard exist                                                             | Pass hosted fake-Paystack E2E and production smoke            | Backend    | Critical |
| Paystack webhook security  | CONDITIONAL PASS | Paystack endpoint verifies HMAC signatures, persists event inbox rows, and handles duplicate deliveries in tests           | Verify against real Supabase/PostgreSQL and Paystack payloads | Backend    | Critical |
| Idempotency                | CONDITIONAL PASS | Order creation requires `Idempotency-Key`; payment webhook events use database uniqueness                                  | Extend idempotency across all remaining mutations             | Backend    | High     |
| Inventory concurrency      | CONDITIONAL PASS | `POST /v1/orders` calls transactional reservation SQL and validates JWT/idempotency before DB mutation                     | Run concurrent real PostgreSQL tests                          | Backend    | High     |
| Order transitions          | CONDITIONAL PASS | SQL and TypeScript transition rules exist                                                                                  | Add handler tests                                             | Backend    | High     |
| Batch assignment           | CONDITIONAL PASS | Vendor/rider/admin batch handlers and assignment operations exist                                                          | Pass hosted E2E and worker checks                             | Backend    | High     |
| Delivery earnings          | CONDITIONAL PASS | Unit tests cover earnings calculation                                                                                      | Wire into delivery settlement flow                            | Backend    | Medium   |
| Vendor settlement          | CONDITIONAL PASS | Super Admin endpoint calls vendor daily settlement SQL                                                                     | Verify with real fixture data and add scheduled generation    | Backend    | High     |
| Rider settlement           | CONDITIONAL PASS | Super Admin endpoint calls rider daily settlement SQL                                                                      | Verify with real fixture data and add scheduled generation    | Backend    | High     |
| Refund accounting          | CONDITIONAL PASS | Refund calculation and admin refund workflow exist                                                                         | Pass hosted E2E and finance reconciliation                    | Backend    | Critical |
| Auditability               | CONDITIONAL PASS | `audit_logs` table and admin audit-log surface exist                                                                       | Pass hosted E2E and incident review                           | Backend    | High     |
| Privacy exposure           | CONDITIONAL PASS | Log redaction and role-scoped response tests exist                                                                         | Pass hosted E2E and security review                           | Backend    | High     |
| Test completeness          | CONDITIONAL PASS | Unit/integration tests, OpenAPI check, hosted E2E harness, and production smoke script exist                               | Execute hosted E2E and production smoke with real secrets     | QA         | Critical |
| API documentation          | CONDITIONAL PASS | OpenAPI generated for business routes and drift check passes                                                               | Compare deployed OpenAPI during production smoke              | Backend    | Medium   |
| Deployment safety          | CONDITIONAL PASS | Render blueprint, Dockerfile, CI/CD, release docs exist                                                                    | Configure real staging/production secrets and scanners        | DevOps     | High     |
| Monitoring                 | CONDITIONAL PASS | Request metrics and runbooks exist                                                                                         | Wire external metrics/alerts                                  | Operations | High     |
| Backup and recovery        | FAIL             | Runbook mentions recovery                                                                                                  | Configure Supabase backups and restore drill                  | DevOps     | High     |
| Operational runbooks       | CONDITIONAL PASS | Runbooks added                                                                                                             | Assign owners and test launch-day drills                      | Operations | Medium   |

## Automatic Fail Criteria

Launch remains blocked until the following are proven:

- payment amount cannot be manipulated;
- inventory cannot be oversold;
- webhook replay cannot duplicate payment effects;
- users cannot access another user's orders;
- vendors cannot access another vendor;
- Campus Admin cannot access another campus;
- settlement totals are traceable to orders;
- service-role credentials are absent from client code;
- migrations can recreate the schema;
- critical paths have automated tests;
- rollback or incident process is approved.
