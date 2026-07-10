# Notes Feature Batch — Design

Date: 2026-07-10
Source: founder notes screenshot (9 items). This spec covers only the items that
require new implementation. See the status table for what already exists.

## Status of all 9 notes

| # | Note | Status | Action |
|---|------|--------|--------|
| 1 | Reduce order closure 1hr → 30min | **Exists** (config) | Data update: `update public.delivery_slots set cutoff_minutes = 30 where cutoff_minutes <> 30;` Column default is already 30. Apply by hand via psql per hosted-db-deploy-model. |
| 2 | Admin add item quantity without going to cafe | **Needs impl** | §1 below |
| 3 | Add room numbers | **Done** | `room_number` col + create-order flow (migration 20260709000100). |
| 4 | Live chat | **Needs impl** (new) | §4 — founder wants 1-on-1 customer↔admin support chat, separate from the existing batch chat. |
| 5 | Orders show customer's number | **Done 2026-07-10** | `customerPhone`/`customerDisplayName` added to vendor + admin order queries and DTOs. |
| 6 | Orders have room number | **Done** | Same as #3. |
| 7 | See difference between charges and sulvatech funds | **Needs impl** | §3 below |
| 8 | Campus admin acct for everybody | **Exists** (mechanism) | `campus_admin` role + `grantMembership` already implemented. Operational: provision one campus_admin per campus. No code. |
| 9 | Push notifications for riders | **Needs impl** | §2 below |

Implementation items in this spec: **§1 admin inventory adjust · §2 rider push · §3 funds
dashboard · §4 support chat.** Each is independent and gets its own implementation plan.

---

## §1 — Admin inventory adjustment

**Goal:** An admin can add stock quantity to any vendor's dated inventory from the admin
panel, instead of physically visiting the cafe.

**What exists:** Vendors already adjust their own inventory via
`POST /inventory/:inventoryId/adjustments` → `InventoryService.createAdjustment` →
`InventoryRepository.recordAdjustment` (append-only adjustments; running total
`quantity_total + quantity_adjusted`). Access is vendor-scoped through
`has_vendor_access`.

**Approach:** Add an admin-facing entry point that reuses the same append-only adjustment
mechanism but authorises via admin role + campus scope instead of vendor ownership.

- New endpoint: `POST /admin/inventory/:inventoryId/adjustments`
  guarded by `@RequireRoles('campus_admin', 'super_admin')` (campus_admin restricted to
  their `campusId`; verify the inventory's vendor belongs to that campus before writing).
- Reuse `recordAdjustment`; pass the admin's `userId` as the actor and stamp the
  adjustment source/actor so audit trails distinguish admin vs vendor adjustments.
- Audit-log via the existing `AuditService`.
- Body: reuse `CreateInventoryAdjustmentDto` (`adjustmentQuantity`, reason/note).

**Files:** `src/modules/admin/*` (new controller route + service method delegating to
inventory repo or a shared helper), `src/modules/inventory/inventory.repository.ts`
(admin-scoped access check if needed), DTO reuse, openapi regen.

**Testing:** unit test admin adjustment happy path, campus-scope rejection (campus_admin
adjusting another campus's vendor), and audit record written.

**Open question:** should campus_admin be allowed, or super_admin only? Default: both,
campus_admin scoped to own campus.

---

## §2 — Push notifications for riders

**Goal:** Riders receive push notifications for events relevant to them (new batch
assignment, order ready for pickup), not just customers.

**What exists:** The outbox → notification pipeline works, but
`create_notification_for_outbox_event` (migration 20260619000900) materialises
notifications for the **order's `customer_id` only**. Riders currently get push only
through batch chat (2026-07-10). The FCM sender + device-token pipeline already support
any user.

**Approach:** Emit rider-recipient notifications for rider-relevant lifecycle events.
Two candidate mechanisms — recommend **A**:

- **A) DB trigger extension (recommended):** extend the notification-materialisation
  function so that for the relevant event types it also resolves the assigned rider's
  user id (via `delivery_assignments` → `riders` → user) and inserts a notification row
  for that rider. Reuses the whole existing outbox/FCM path. Keep it a new migration
  (append-only style, matching repo convention).
- B) Application-side emit when an assignment is created. Rejected: duplicates logic the
  DB trigger already owns and risks divergence from the customer path.

**Trigger events for riders:** batch assigned to rider (primary — "you have a new
delivery"), and optionally `order.ready` for orders in the rider's batch. Respect
`notification_preferences` (`delivery_updates`, `push_enabled`) as the customer path does.

**Files:** new `supabase/migrations/<ts>_rider_lifecycle_notifications.sql`; possibly a
new notification topic/type; no app code if fully DB-driven.

**Testing:** migration/DB test that an assignment creates a rider notification row;
verify preference gating; verify no duplicate customer notifications.

**Open question:** exact event set — assignment only, or assignment + order.ready?
Default: assignment first, add order.ready if riders want per-order pings.

---

## §3 — Charges vs Sulvatech funds dashboard

**Goal:** Admin sees, live, the split between money customers were charged and Sulvatech's
own net take, so they can tell platform revenue apart from pass-through funds.

**What exists:** `pricing.ts` computes per-order fees; the settlements module computes
per-beneficiary payables (`previewSettlement` aggregates food subtotal, delivery earnings,
service fee, refunds). No single view expresses "customer charges vs platform net take."

**Definitions (to confirm with founder):**
- **Total customer charges** = sum of `total_kobo` for paid orders in scope.
- **Vendor payouts** = food subtotal + vendor delivery share (vendor_delivery mode).
- **Rider payouts** = rider delivery earnings.
- **Platform net take (Sulvatech funds)** = service fees + large-order surcharge +
  platform delivery share − refunds attributable to platform. i.e. charges − vendor
  payouts − rider payouts.

**Approach:** New admin read-only reporting endpoint returning aggregate figures.

- Endpoint: `GET /admin/finance/summary?campusId=&dateFrom=&dateTo=`
  guarded `@RequireRoles('campus_admin','super_admin')`, campus_admin scoped to own campus.
- Single aggregation query over paid/settled orders in the window: returns
  `{ grossChargesKobo, vendorPayoutsKobo, riderPayoutsKobo, platformNetKobo,
  serviceFeesKobo, surchargeKobo, refundsKobo, orderCount }`.
- Read-only, no schema change. Reuse the fee columns already on `orders`.

**Files:** `src/modules/admin/*` (controller route + service + repository query), new DTO,
openapi regen.

**Testing:** unit test the aggregation against seeded orders; verify campus scoping;
verify the identity `grossCharges = vendorPayouts + riderPayouts + platformNet + refunds`
holds on the fixture.

**Open question:** confirm the exact revenue definition above with the founder before
building, since "Sulvatech funds" is their term. This is the one item where a wrong
definition wastes the most work.

---

## §4 — Customer ↔ Admin support chat (1-on-1)

**Goal:** A customer can start a direct support conversation with admin/support, separate
from the per-batch group chat. Admin has an inbox of these threads.

**What exists:** The batch chat (2026-07-10) provides message tables, Supabase Realtime
wiring, and an FCM outbox push pattern to copy — but it is group-scoped to a delivery
batch and pseudonymises customers. Support chat is a different model: identified 1-on-1,
customer-initiated, admin-answered.

**Approach:** New thread model, reusing the realtime + push patterns from batch chat.

- Tables: `support_threads` (id, customer_id, campus_id, subject?, status
  open/closed, assigned_admin_id?, last_message_at, created_at) and `support_messages`
  (id, thread_id, sender_user_id, sender_role, body, created_at).
- Realtime: enable on `support_messages` (mirror `20260619001200_enable_realtime.sql`).
- Push: on new message, enqueue an outbox event → notify the counterparty (customer→admins
  of that campus; admin→the thread's customer). Reuse the asymmetric push pattern.
- Endpoints:
  - Customer: `POST /support/threads` (start/create), `GET /support/threads` (mine),
    `GET /support/threads/:id/messages`, `POST /support/threads/:id/messages`.
  - Admin: `GET /admin/support/threads` (inbox, campus-scoped, filter by status),
    `POST /admin/support/threads/:id/messages`, `PATCH /admin/support/threads/:id`
    (assign / close).
- RLS: customer sees only own threads; admins see campus threads.

**Files:** new `src/modules/support/*` module, new migration(s), openapi regen, tests.
This is the largest item (~1–2 days) — build last.

**Open questions:** (a) is support routed per-campus or to a global support queue?
Default: per-campus, super_admin sees all. (b) do we need thread subject/category, or
freeform only? Default: freeform + optional subject.

---

## Sequencing

1. §1 admin inventory adjust (self-contained, high daily value)
2. §2 rider push (DB migration, reuses pipeline)
3. §3 funds dashboard (confirm revenue definition first)
4. §4 support chat (largest; build last)

Each item is independently shippable and gets its own implementation plan.
