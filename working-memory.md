# Working Memory

## Problem Summary

Meal Direct backend is being built from API foundation into production-hardened service. Current work added protected order creation, database-backed Paystack webhook handling, Super Admin settlement generation endpoints, Render/pnpm build stabilization, CI/deployment scaffolding, security documentation, observability, and launch audit updates.

## Stack and Runtime

- Node.js 24 target.
- NestJS 11 with Fastify.
- TypeScript, Vitest, ESLint, Prettier.
- PostgreSQL/Supabase migrations and pgTAP database tests.
- Render deployment target.

## Confirmed Facts

- API currently has health, authenticated `/auth/me`, customer order creation, Paystack webhook, Super Admin settlement generation, and protected operations endpoints.
- Business modules have initial order/payment/settlement surfaces; full vendor/rider/admin/customer product flows are not implemented yet.
- Database migrations include core schema, RLS, order/payment/batch/settlement functions, and seed data.
- Local machine lacks Supabase CLI/Docker, so full database CI could not be run locally.
- Render Docker install failure from pnpm minimum release age was addressed by declaring `packageManager: pnpm@10.24.0`, overriding `esbuild` to `0.28.0`, and regenerating `pnpm-lock.yaml`.
- Live Render smoke test on 2026-06-13 showed `/v1/health/live`, `/docs`, OpenAPI, and unauthenticated guard failures working, but `/v1/health/ready` returned `DATABASE_UNAVAILABLE`.
- Redacted database diagnostics against the Supabase pooler showed current strict TLS verification fails with `SELF_SIGNED_CERT_IN_CHAIN`; relaxing certificate-chain validation reaches Postgres but the available local production URL then fails password authentication.
- CORS disallowed-origin preflight previously surfaced as a 500; the app now disables CORS for disallowed origins instead of raising a server error.
- Render logs confirmed `/v1/health/ready` failed with `SELF_SIGNED_CERT_IN_CHAIN`. `pg-connection-string` treats `sslmode=require` as strict verification by default and parsed connection-string values override separately supplied pool config. `DatabaseService` now strips SSL query params from `DATABASE_URL` whenever it supplies an explicit SSL object, preventing `sslmode=require` from overriding `{ rejectUnauthorized: false }`.
- Readiness failures now log sanitized database error metadata under `HealthController` before returning the unchanged public `DATABASE_UNAVAILABLE` response.
- Module 9 vendor profile/payout/menu/availability contract is sourced from `Meal_Direct_Vendor_Frontend_AI_Studio_Prompts.zip`; routes are singular `/v1/vendor/...`.
- Module 9 now registers protected vendor endpoints for profile, masked payout account, menu metadata, menu item create/read/update/activate/deactivate, menu item schedules, and vendor availability. Inventory remains Module 10.
- Module 10 vendor inventory contract is sourced from the same vendor prompt pack and uses `GET /v1/vendor/inventory?date=&slotId=`, `PUT /v1/vendor/inventory/:inventoryId`, and `POST /v1/vendor/inventory/:inventoryId/adjustments`.
- Module 10 reuses existing `menu_item_inventory`, `inventory_adjustments`, and `record_inventory_adjustment`; no DB schema migration was added.
- Module 12 vendor settlements/reviews contract is sourced from `Meal_Direct_Vendor_Frontend_AI_Studio_Prompts.zip` and uses `GET /v1/vendor/settlements?cursor=&dateFrom=&dateTo=`, `GET /v1/vendor/settlements/:id`, and `GET /v1/vendor/reviews?cursor=&menuItemId=&rating=`.
- Module 12 reuses existing `settlements`, `settlement_lines`, `reviews`, and `has_vendor_access`; no DB schema migration was added.
- Vendor review read models intentionally omit `reviewerId` to protect customer identity while preserving order/menu context for permitted vendor users.
- Vendor order/batch aliases were added for frontend-contract compatibility: `POST /v1/vendor/orders/:orderId/preparing` and `POST /v1/vendor/batches/:batchId/ready-for-pickup`; the existing `/prepare` and `/pickup` routes remain.
- Modules 13-15 rider contract is sourced from `Meal_Direct_Rider_Frontend_AI_Studio_Prompts.zip` and uses singular `/v1/rider/...` routes for profile, assignments, delivery order flow, issues, earnings, and settlements.
- Modules 13-15 reuse existing `riders`, `delivery_assignments`, `delivery_batches`, `delivery_batch_orders`, `orders`, `escalations`, `settlements`, `settlement_lines`, `has_rider_access`, and `transition_order_status`; no DB schema migration was added.
- Rider profile lookup supports JWT `rider_id` when present and falls back to `riders.user_id` for older tokens. Operational rider endpoints require an active verified rider.
- Rider delivery issue reporting uses `public.escalations` with `rider_`-prefixed categories; riders cannot decide refunds.
- Modules 16-20 admin contract is sourced from `Meal_Direct_Admin_Frontend_AI_Studio_Prompts.zip` and uses `/v1/admin/...` routes for session, dashboard, order ops, batch assignment, vendor/rider directories, inventory adjustments, escalations, settlements, reviews, users, admin memberships, analytics, and audit logs.
- Admin service scoping pins `campus_admin` actors to their JWT `campus_id`; `super_admin` can query globally or by requested campus. User status changes and admin membership management are super-admin-only.
- Module 21 is implemented over existing `public.outbox_events`, exposing admin-only system summary, outbox listing, and available-event claiming endpoints. Claiming leases outbox events for a worker and does not mark them processed without a real handler.

## Current Contracts

- `GET /v1/health/live`
- `GET /v1/health/ready`
- `GET /v1/auth/me` protected by Supabase JWT
- `POST /v1/orders` protected by Supabase JWT, customer role, and `Idempotency-Key`
- `POST /v1/payments/webhooks/paystack` protected by Paystack HMAC signature, with database-backed event inbox outside test mode
- `POST /v1/settlements/vendors/:vendorId/daily` protected by Supabase JWT and `super_admin` role
- `POST /v1/settlements/riders/:riderId/daily` protected by Supabase JWT and `super_admin` role
- `GET /v1/operations/status` protected by `INTERNAL_OPERATIONS_TOKEN`
- `GET/PATCH /v1/vendor/profile` protected by Supabase JWT, `vendor` role, and `vendor_users` object access
- `GET/PUT /v1/vendor/payout-account` protected by Supabase JWT, `vendor` role, and masked payout snapshot logic
- `GET /v1/vendor/menu-metadata`
- `GET/POST /v1/vendor/menu-items`
- `GET/PATCH /v1/vendor/menu-items/:itemId`
- `POST /v1/vendor/menu-items/:itemId/activate`
- `POST /v1/vendor/menu-items/:itemId/deactivate`
- `GET/PUT /v1/vendor/menu-items/:itemId/schedules`
- `GET/PUT /v1/vendor/availability`
- `GET /v1/vendor/inventory?date=&slotId=`
- `PUT /v1/vendor/inventory/:inventoryId`
- `POST /v1/vendor/inventory/:inventoryId/adjustments`
- `GET /v1/vendor/orders?cursor=&date=&status=&slotId=&zoneId=`
- `GET /v1/vendor/orders/:orderId`
- `POST /v1/vendor/orders/:orderId/accept`
- `POST /v1/vendor/orders/:orderId/prepare`
- `POST /v1/vendor/orders/:orderId/preparing`
- `POST /v1/vendor/orders/:orderId/ready`
- `GET /v1/vendor/batches?date=&status=`
- `GET /v1/vendor/batches/:batchId`
- `POST /v1/vendor/batches/:batchId/pickup`
- `POST /v1/vendor/batches/:batchId/ready-for-pickup`
- `GET /v1/vendor/settlements?cursor=&dateFrom=&dateTo=`
- `GET /v1/vendor/settlements/:id`
- `GET /v1/vendor/reviews?cursor=&menuItemId=&rating=`
- `GET/PATCH /v1/rider/profile`
- `GET /v1/rider/assignments?cursor=&date=&status=`
- `GET /v1/rider/assignments/:assignmentId`
- `POST /v1/rider/assignments/:assignmentId/accept`
- `POST /v1/rider/assignments/:assignmentId/picked-up`
- `GET /v1/rider/orders/:orderId`
- `POST /v1/rider/orders/:orderId/out-for-delivery`
- `POST /v1/rider/orders/:orderId/delivered`
- `POST /v1/rider/orders/:orderId/issues`
- `GET /v1/rider/earnings?dateFrom=&dateTo=`
- `GET /v1/rider/settlements?cursor=&status=`
- `GET /v1/rider/settlements/:id`
- `GET /v1/admin/session`
- `GET /v1/admin/dashboard?campusId=&date=`
- `GET /v1/admin/orders?campusId=&date=&status=&vendorId=&slotId=&search=`
- `GET /v1/admin/orders/:orderId`
- `POST /v1/admin/orders/:orderId/cancel`
- `POST /v1/admin/orders/:orderId/status-transition`
- `GET /v1/admin/batches?campusId=&date=&status=&vendorId=&zoneId=`
- `GET /v1/admin/batches/:batchId`
- `POST /v1/admin/batches/:batchId/close`
- `POST /v1/admin/batches/:batchId/assign-rider`
- `POST /v1/admin/batches/:batchId/assign-vendor-delivery`
- `POST /v1/admin/batches/:batchId/reassign-rider`
- `POST /v1/admin/batches/:batchId/cancel-assignment`
- `GET/POST /v1/admin/vendors`
- `GET/PATCH /v1/admin/vendors/:vendorId`
- `POST /v1/admin/vendors/:vendorId/approve`
- `POST /v1/admin/vendors/:vendorId/suspend`
- `POST /v1/admin/vendors/:vendorId/activate`
- `POST /v1/admin/vendors/:vendorId/users`
- `GET /v1/admin/vendors/:vendorId/performance`
- `GET /v1/admin/riders`
- `GET /v1/admin/riders/:riderId`
- `GET /v1/admin/riders/:riderId/assignments`
- `GET /v1/admin/riders/:riderId/settlements`
- `POST /v1/admin/riders/:riderId/verify`
- `POST /v1/admin/riders/:riderId/suspend`
- `POST /v1/admin/riders/:riderId/activate`
- `GET /v1/admin/inventory?campusId=&date=&slotId=&vendorId=&state=`
- `POST /v1/admin/inventory/:inventoryId/adjustments`
- `GET /v1/admin/escalations`
- `GET /v1/admin/escalations/:id`
- `POST /v1/admin/escalations/:id/assign`
- `POST /v1/admin/escalations/:id/request-evidence`
- `POST /v1/admin/escalations/:id/resolve`
- `POST /v1/admin/escalations/:id/refunds`
- `GET /v1/admin/settlements`
- `POST /v1/admin/settlements/preview`
- `POST /v1/admin/settlements/generate`
- `GET /v1/admin/settlements/:id`
- `POST /v1/admin/settlements/:id/approve`
- `POST /v1/admin/settlements/:id/mark-paid`
- `POST /v1/admin/settlements/:id/adjustments`
- `GET /v1/admin/reviews`
- `POST /v1/admin/reviews/:reviewId/moderate`
- `GET /v1/admin/users`
- `GET /v1/admin/users/:userId`
- `POST /v1/admin/users/:userId/suspend`
- `POST /v1/admin/users/:userId/activate`
- `GET/POST /v1/admin/admin-memberships`
- `POST /v1/admin/admin-memberships/:id/revoke`
- `POST /v1/admin/admin-memberships/:id/activate`
- `GET /v1/admin/analytics`
- `GET /v1/admin/audit-logs`
- `GET /v1/admin/system`
- `GET /v1/admin/jobs/outbox?status=&eventType=&limit=`
- `POST /v1/admin/jobs/outbox/process`
- OpenAPI artifacts in `docs/openapi.json` and `docs/openapi.yaml`

## Remaining Launch Blockers

- Applying Supabase JWT/RBAC guards to all business routes.
- Object-level authorization in business routes.
- Paystack initialization and refund workflow.
- Live database verification for order reservation, payment webhook side effects, and settlement generation.
- Remaining customer endpoint flows and broader database-backed E2E tests.
- External observability/alerting provider configuration.
- Full `pnpm db:ci` verification with Supabase CLI and Docker.
- After the next Render deploy, check `/v1/health/ready`; if it still fails, inspect Render logs for the sanitized `HealthController` database error code/message.
