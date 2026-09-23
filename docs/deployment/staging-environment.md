# Staging environment and test mode

Two ways to try new work without hurting production. Pick based on risk.

|                  | Feature-flag test mode                                                | Staging environment                                                                |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| What it isolates | **Who sees a feature**                                                | **The data**                                                                       |
| Database         | Production                                                            | Separate Supabase project                                                          |
| Good for         | New UI/flows (cloud printing, new screens) exercised by test accounts | Migrations, backfills, payout/fee changes, anything that writes money or bulk data |
| Setup            | Already built — admin API                                             | One-time infra setup below                                                         |

## 1. Feature-flag test mode (built)

Every new feature gets a row in `public.feature_flags` with mode `off` / `test` / `on`.
In `test`, only users/vendors listed in `public.feature_testers` get it.

```http
POST  /v1/admin/feature-testers        { "subjectType": "vendor", "subjectId": "<vendor uuid>", "note": "pilot" }
POST  /v1/admin/feature-testers        { "subjectType": "user",   "subjectId": "<profile uuid>" }
PATCH /v1/admin/feature-flags/cloud_printing   { "mode": "on" }    # roll out
PATCH /v1/admin/feature-flags/cloud_printing   { "mode": "off" }   # kill switch
GET   /v1/me/feature-flags                                          # what the caller sees
```

All admin calls need the `admin:manage` permission and are audited.

Recommended flow: create a **test vendor** and **test customer** on production, add both as
testers, place orders with Paystack test cards (prod still runs `sk_test_`), verify, then flip
to `on`.

Adding a flag for a new feature: insert the row in the feature's migration
(`insert into public.feature_flags (key, mode, description) values ('my_feature', 'test', '…')`),
add the key to `FeatureFlagKeys` in `src/modules/feature-flags/feature-flags.types.ts`, and gate
with `FeatureFlagsService.isEnabled(key, subjectForActor(actor))`. Frontends read
`GET /v1/me/feature-flags` to hide unfinished UI.

**Limit:** test-mode orders are real production rows (they appear in admin lists, settlements
and reports). Use staging for anything that must not touch production data.

## 2. Staging environment (not yet provisioned)

`src/config/env.ts` already accepts `NODE_ENV=staging` and applies production-grade checks
(SSL, JWT verification, Resend) to it.

One-time setup:

1. **Supabase:** create a second project (e.g. `mealdirect-staging`). Apply every file in
   `supabase/migrations/` in version order (`psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f …`),
   then optionally `supabase/seed.sql`.
2. **Render:** duplicate the `meal-direct-api` web service as `meal-direct-api-staging`
   (same Dockerfile, deploy from a `staging` branch or manually). Env vars:
   - `NODE_ENV=staging`
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL` → the staging project
   - `PAYSTACK_SECRET_KEY` → an `sk_test_` key; `PAYOUTS_ENABLED=false`
   - `CORS_ALLOWED_ORIGINS` → staging frontend URLs
   - `SENTRY_ENVIRONMENT=staging`
3. **Frontends:** point Vercel preview deployments at the staging API URL.
4. **Paystack:** set the staging webhook URL on the test-mode dashboard only if production is not
   already using the test-mode webhook (Paystack allows one webhook URL per mode) — otherwise
   rely on the reconcile cron in staging.

Release flow: merge → deploy staging → apply new migrations to staging → smoke test → apply to
production → deploy production.
