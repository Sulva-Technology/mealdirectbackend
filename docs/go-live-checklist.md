# Go-Live Checklist

- Paystack live keys stored in production secret management.
- Paystack webhook URL configured to production API.
- Paystack webhook signature test passed.
- Hosted E2E Supabase project is separate from production.
- `pnpm test:e2e:hosted` passed against hosted E2E/staging.
- `pnpm smoke:production` passed after deployment.
- `pnpm readiness:launch` passed in the launch environment.
- `pnpm db:ci` passed with Supabase CLI and Docker available.
- Production migrations were run once from the controlled release process.
- Supabase backups/PITR policy confirmed.
- Supabase connection pooler settings confirmed.
- RLS status confirmed for production tables.
- Google OAuth production redirects configured.
- User frontend domain configured.
- Vendor frontend domain configured.
- Rider frontend domain configured.
- Admin frontend domain configured.
- API domain `api.mealdirectly.com` configured.
- TLS active for all public domains.
- Exact CORS origins configured.
- Vendor records loaded and verified.
- Rider records loaded and verified.
- Campus locations loaded and verified.
- Delivery slots loaded and verified.
- Launch inventory loaded and verified.
- Support roster assigned.
- Escalation owner assigned.
- Settlement bank process approved.
- Privacy policy published.
- Terms published.
- Vendor agreement approved.
- Rider agreement approved.
- Monitoring dashboards active.
- Alerts routed to on-call owner.
- `SENTRY_DSN` + `SENTRY_ENVIRONMENT` set in production; release/commit tagging confirmed.
- Outbox worker deployed; email (Resend) and push (FCM) credentials configured.
- Supabase Realtime publication enabled for order/notification/assignment changes.
- Zone delivery fees configured per campus zone; promotion codes seeded/validated.
- Rider availability + auto-dispatch verified (available verified riders assigned on `order.ready`).
- `SUPABASE_JWKS_URL` configured for asymmetric JWT verification (HS256 secret retained as fallback).
- Email confirmations enabled (`enable_confirmations = true`); password-reset/resend flows verified.
- `PAYOUTS_ENABLED` left `false` until a controlled enablement; transfer recipient + balance funding confirmed first.
- Backups configured.
- Restore drill completed.
- Launch-day smoke test completed for customer, vendor, rider, and admin flows.

## `PAYOUTS_ENABLED` flip checklist

Automated payouts stay off until every item below is confirmed. Flip `PAYOUTS_ENABLED`
to `true` (web + both payout crons) only once all pass.

1. Vendor & rider payout accounts provisioned (Paystack recipient codes present) and
   **admin-approved** (`admin_review_status = 'approved'` via `PATCH /admin/payout-accounts/{vendor|rider}/:id/review`).
2. Paystack transfer balance funded and transfers enabled on the Paystack account; OTP policy decided.
3. Both crons registered on Render with sane schedules — `run-payouts` daily after settlement
   generation (`30 3 * * *`); `reconcile-payout-transfers` every ~15 min (`*/15 * * * *`).
4. Guardrail settings seeded: `payout_hold_hours` (default 24) and `payout_max_attempts` (default 3)
   in `platform_settings`.
5. One end-to-end test transfer to a real account initiated and reconciled (webhook or the
   active reconcile sweep) end-to-end.
6. Admin payout-transfer queue (`GET /admin/payout-transfers`, filter `status=needs_admin`)
   reviewed as the failure escape hatch.
