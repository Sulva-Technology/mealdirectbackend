# Meal Direct Threat Model

Status: draft, repository-grounded. This model uses the current backend and database state and must be revalidated when API business endpoints are implemented.

## Assumptions

- Public frontends are `user.mealdirect.com`, `vendor.mealdirect.com`, `rider.mealdirect.com`, and `admin.mealdirect.com`.
- Public API is served by Render at `api.mealdirect.com`.
- Supabase Auth issues JWTs and PostgreSQL remains the source of truth.
- Paystack handles payment initialization, webhooks, refunds, and payout references.
- The current API has foundation endpoints only; full auth, order, payment, delivery, and admin handlers are not implemented yet.

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

| Boundary                     | Current Evidence                       | Required Control                                                       |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Browser frontends to API     | CORS allowlist in env and Fastify CORS | exact origins, JWT validation, rate limits, payload limits             |
| API to Supabase/PostgreSQL   | Kysely pool and migrations             | least-privilege DB role, RLS, transactional mutations                  |
| API to Paystack              | Paystack secret env placeholder        | HMAC/signature validation, idempotency, replay window                  |
| Paystack to webhook endpoint | endpoint not implemented               | signature validation before parsing side effects                       |
| API to logs/metrics          | structured logger and redaction        | no secrets/PII beyond lawful operational IDs                           |
| Admin operations endpoint    | bearer operations token guard          | replace with Super Admin JWT/RBAC before launch                        |
| CI/CD to staging/production  | GitHub workflows and Render blueprint  | separate secrets, manual production approval, single migration process |

## Abuse Cases

| Abuse Case                           | Impact                            | Existing Control                                  | Gap                                                                              |
| ------------------------------------ | --------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Customer reads another user's order  | PII and order exposure            | DB `can_read_order` and RLS functions exist       | API object authorization not implemented                                         |
| Vendor reads another vendor's orders | cross-vendor leakage              | vendor access functions and RLS exist             | API handlers not implemented                                                     |
| Campus Admin accesses another campus | cross-campus data leak            | campus admin DB functions exist                   | API RBAC not implemented                                                         |
| Payment amount manipulation          | underpayment or free orders       | DB amount columns and payment functions exist     | API payment initialization not implemented                                       |
| Duplicate payment webhook            | duplicate paid effects            | `payment_events` and idempotency schema exist     | webhook endpoint/signature/replay not implemented                                |
| Inventory oversell                   | customer harm and vendor disputes | reservation function exists                       | API order reservation not implemented                                            |
| Fake delivery confirmation           | fraudulent completion             | delivery confirmation table exists                | API rider/customer confirmation not implemented                                  |
| Duplicate refund                     | financial loss                    | refund schema exists                              | refund workflow not implemented                                                  |
| Stolen token                         | account takeover                  | CORS/rate limits exist                            | JWT verification and session revocation checks missing                           |
| Secret leakage                       | infrastructure compromise         | env examples omit values and log redaction exists | dependency/code/container scanning must run in CI                                |
| DoS                                  | API unavailable                   | Fastify rate limit, payload limit, health checks  | per-user/per-route limits and alerting not complete                              |
| Malicious future file upload         | malware or data leak              | no upload surface today                           | storage scanning and content-type validation required before image upload launch |

## Required Mitigations

- Implement Supabase JWT verification middleware and derive actor context from verified claims.
- Enforce RBAC and object-level authorization in every business handler.
- Keep high-value mutations inside database transactions or SQL functions.
- Validate Paystack webhooks with the provider signature before reading side-effect fields.
- Store processed webhook event IDs and idempotency keys with unique constraints.
- Filter API responses by role and avoid exposing payout account details except masked snapshots.
- Add audit log writes for admin actions, payment effects, settlement approvals, refunds, and escalations.
- Keep migrations separate from API startup and run them exactly once per release.
- Configure alerts for readiness failure, webhook failures, dead-letter events, invalid signatures, refund spikes, and settlement discrepancies.

## Open Questions

- Who owns security response and production incident command?
- Which Supabase project refs are staging and production?
- What are the exact Paystack webhook signing headers and live webhook URL?
- What data-retention policy applies to PII, audit logs, and payout snapshots?
