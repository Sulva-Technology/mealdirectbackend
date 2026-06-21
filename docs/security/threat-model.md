# Meal Direct Threat Model

Status: draft, repository-grounded. This model uses the current backend and database state and must be revalidated after hosted E2E and production smoke pass.

## Assumptions

- Public frontends are `user.mealdirectly.com`, `vendor.mealdirectly.com`, `rider.mealdirectly.com`, and `admin.mealdirectly.com`.
- Public API is served by Render at `api.mealdirectly.com`.
- Supabase Auth issues JWTs and PostgreSQL remains the source of truth.
- Paystack handles payment initialization, webhooks, refunds, and payout references.
- Customer, vendor, rider, admin, payment, settlement, notification, and outbox handlers are implemented; hosted E2E and production smoke remain the launch proof gates.

## Assets

- Customer PII: names, phone numbers, campus, locations, order history.
- Vendor data: menus, inventory, payout recipients, settlement records.
- Rider data: identity, assignments, delivery earnings.
- Payment data: Paystack references, webhook payloads, refund records.
- Integrity-critical state: inventory reservations, order statuses, delivery confirmations, settlement lines, audit logs.
- Secrets: Supabase JWT secrets/service role, database URLs, Paystack secret key, operations token, GitHub/Render secrets.

## Actors

- Anonymous internet user.
- Authenticated customer.
- Vendor owner or staff.
- Rider.
- Campus Admin.
- Super Admin.
- Paystack webhook sender.
- CI/CD and deployment automation.
- Malicious insider with limited operational access.

## Trust Boundaries

| Boundary                     | Current Evidence                                                                                                         | Required Control                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Browser frontends to API     | CORS allowlist, Fastify CORS, Supabase JWT verifier, actor context, RBAC guard                                           | exact origins, hosted E2E coverage, rate limits, payload limits        |
| API to Supabase/PostgreSQL   | Kysely pool, migrations, transactional SQL functions, RLS                                                                | least-privilege DB role and hosted DB verification                     |
| API to Paystack              | Paystack client, signed webhook verification, optional E2E base URL, production base URL guard                           | live key and webhook URL validation                                    |
| Paystack to webhook endpoint | `/v1/payments/webhooks/paystack` verifies `x-paystack-signature` and handles duplicate deliveries idempotently in the DB | hosted E2E and production unsigned-payload smoke                       |
| API to logs/metrics          | structured logger and redaction                                                                                          | no secrets/PII beyond lawful operational IDs                           |
| Admin operations endpoint    | bearer operations token guard                                                                                            | replace with Super Admin JWT/RBAC before launch                        |
| CI/CD to staging/production  | GitHub workflows and Render blueprint                                                                                    | separate secrets, manual production approval, single migration process |

## Abuse Cases

| Abuse Case                           | Impact                            | Existing Control                                                                        | Gap                                                                              |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Customer reads another user's order  | PII and order exposure            | DB `can_read_order`, API scoping, and RLS functions exist                               | hosted E2E proof                                                                 |
| Vendor reads another vendor's orders | cross-vendor leakage              | vendor access functions, route scoping, and RLS exist                                   | hosted E2E proof                                                                 |
| Campus Admin accesses another campus | cross-campus data leak            | campus admin DB functions and cross-campus API denial exist                             | hosted E2E proof                                                                 |
| Payment amount manipulation          | underpayment or free orders       | server-side order total/payment initialization and Paystack verify mapping              | hosted E2E/live smoke proof                                                      |
| Duplicate payment webhook            | duplicate paid effects            | Webhook signature verification, `payment_events`, and duplicate delivery handling exist | hosted E2E proof                                                                 |
| Inventory oversell                   | customer harm and vendor disputes | order API calls transactional reservation SQL                                           | hosted concurrency proof                                                         |
| Fake delivery confirmation           | fraudulent completion             | rider/customer delivery confirmation handlers and status guards exist                   | hosted E2E proof                                                                 |
| Duplicate refund                     | financial loss                    | refund workflow caps refundable amount and records provider references                  | hosted E2E proof                                                                 |
| Stolen token                         | account takeover                  | CORS/rate limits exist                                                                  | JWT verification and session revocation checks missing                           |
| Secret leakage                       | infrastructure compromise         | env examples omit values and log redaction exists                                       | dependency/code/container scanning must run in CI                                |
| DoS                                  | API unavailable                   | Fastify rate limit, payload limit, health checks                                        | per-user/per-route limits and alerting not complete                              |
| Malicious future file upload         | malware or data leak              | no upload surface today                                                                 | storage scanning and content-type validation required before image upload launch |

## Required Mitigations

- Keep Supabase JWT verification, RBAC, and object-level authorization on every non-public business handler.
- Keep high-value mutations inside database transactions or SQL functions.
- Persist Paystack webhook idempotency and side effects in the database after signature verification.
- Store processed webhook event IDs and idempotency keys with unique constraints.
- Filter API responses by role and avoid exposing payout account details except masked snapshots.
- Keep audit log writes for admin actions, payment effects, settlement approvals, refunds, and escalations.
- Keep migrations separate from API startup and run them exactly once per release.
- Configure alerts for readiness failure, webhook failures, dead-letter events, invalid signatures, refund spikes, and settlement discrepancies.
- Run `pnpm test:e2e:hosted` against an isolated hosted Supabase project and `pnpm smoke:production` after deployment before launch.

## Open Questions

- Who owns security response and production incident command?
- Which Supabase project refs are staging and production?
- What are the exact Paystack webhook signing headers and live webhook URL?
- What data-retention policy applies to PII, audit logs, and payout snapshots?
