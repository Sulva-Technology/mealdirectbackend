# Security Policy

## Supported Scope

Security reports for the Meal Direct backend, Supabase migrations, deployment configuration, CI workflows, and operational runbooks are in scope.

## Responsible Disclosure

Send reports privately to the Meal Direct engineering owner before public disclosure. Include:

- affected component or endpoint;
- reproduction steps;
- expected and actual impact;
- logs, request IDs, or screenshots when safe;
- whether credentials, personal data, payment records, or payout data may be exposed.

Do not test against production data, attempt persistence, exfiltrate data, disrupt service, or access accounts you do not own.

## Initial Response Targets

- Critical: acknowledge within 24 hours and start incident handling immediately.
- High: acknowledge within 2 business days.
- Medium and low: acknowledge within 5 business days.

## Incident Response

1. Triage severity and affected assets.
2. Preserve request IDs, trace IDs, audit logs, deployment version, and commit SHA.
3. Rotate exposed secrets before deploying fixes.
4. Disable affected credentials, admin accounts, vendors, riders, or webhooks when needed.
5. Patch in staging, run database and API smoke tests, then promote through the production release process.
6. Record customer/vendor/rider impact and notification requirements.
7. Complete a post-incident review with prevention tasks and owners.

## Security Baseline

Required controls before production launch:

- Supabase JWT verification and RBAC at API boundaries.
- Object-level authorization for users, vendors, riders, Campus Admins, and Super Admins.
- RLS enabled and tested on tenant, order, payment, settlement, and payout tables.
- Paystack webhook signature validation, idempotency, and replay protection.
- Immutable payment, refund, settlement, order status, inventory adjustment, and audit history.
- Exact CORS allowlist for the four frontend domains.
- No service-role keys in client code or logs.
- Session tokens held only in httpOnly cookies at every portal — never in
  `localStorage`/`sessionStorage` or other browser-readable JS. Each portal
  reaches the backend through a same-origin BFF/proxy that injects the bearer
  server-side (`admin`, `user`, `vendor`, `rider`).
- Stricter per-IP rate limiting on unauthenticated credential endpoints
  (`AUTH_RATE_LIMIT_MAX`), on top of the global limit.
- API docs (`/docs`) disabled in production (`ENABLE_API_DOCS=false`).
- `AUTH_ALLOW_USER_METADATA_ROLE_FALLBACK=false` in production; role authority
  comes only from `app_metadata`.
- Multi-factor auth required on all `super_admin` accounts (Supabase Auth): a
  `super_admin` JWT bypasses the granular permission guard by design, so the
  account itself must be hardened.
- Production secrets only in Supabase, Render, GitHub, and Paystack secret stores.
