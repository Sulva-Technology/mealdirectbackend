# Fee configuration + order cap — design

Date: 2026-06-27
Status: Approved (pending spec review)

## Problem

Three pricing concerns are currently hardcoded or unmanageable by operators:

1. **Delivery fee** (`campus_zones.delivery_fee_kobo`, default ₦150) can only be changed by
   direct DB edit — there is no admin endpoint. Campus admins and super admins need to set it.
2. **Takeaway/packaging fee** (`SERVICE_FEE_KOBO` env, default ₦200) is a single global value.
   Vendors should set their own, within an admin-imposed ceiling.
3. **No maximum order value** exists. Orders should be capped at ₦2490 total.

## Current state (verified)

- `campus_zones.delivery_fee_kobo integer not null default 15000` — per-zone, read by the order
  quote and by `create_pending_order_and_reserve_inventory`.
- Order delivery split: `orders.fulfiller_delivery_share_kobo` (rider/vendor share, ₦75) and
  `orders.platform_delivery_share_kobo` (₦75). **Both are pinned to 7500 by a CHECK constraint
  that is independent of `delivery_fee_kobo`.** Settlement pays the fulfiller exactly
  `fulfiller_delivery_share_kobo`; the platform implicitly nets `delivery_fee − fulfiller share`.
  `platform_delivery_share_kobo` is a recorded pilot constant, not used in payout math.
- Takeaway fee: `SERVICE_FEE_KOBO` env (default 20000), surfaced as `serviceFeeKobo` on the quote
  and passed to the RPC param `p_service_fee_kobo`; persisted as `orders.service_fee_kobo`.
- `AdminController` is guarded by `@RequireRoles('campus_admin','super_admin')` at the class level —
  all new admin endpoints inherit this.
- Vendor self-service profile edit exists: `PATCH /vendor/profile` → `VendorsService.updateProfile`.
- Tables `public.campuses`, `public.campus_zones`, `public.vendors` all exist.
- Order total formula: `total_kobo = food_subtotal_kobo + delivery_fee_kobo + service_fee_kobo − discount_kobo`.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Delivery-fee split | Keep 75/75. Rider always ₦75; only the total fee becomes admin-editable. |
| Delivery-fee scope | Per-zone (existing model). |
| Takeaway fee | Per-vendor value, bounded by an admin-set ceiling. |
| Ceiling location | Per-campus column `campuses.max_service_fee_kobo`, admin-editable. |
| Max purchase basis | Order **total** (food + delivery + takeaway − discount). |
| Cap behavior | Hard reject at create (service layer + RPC). Quote still computes. |

## Design

### 1. Admin-editable delivery fee (per-zone)

- **Endpoint:** `PATCH /admin/campus-zones/:zoneId`, body `{ deliveryFeeKobo: number }`.
  Inherits the `campus_admin` / `super_admin` guard.
- **Scope check:** campus admins may only edit zones whose `campus_id` is within their admin scope
  (reuse the existing admin scope/authorization helper used by other campus-scoped admin ops).
  Super admins unrestricted.
- **Validation:** integer; `>= 7500` (rider ₦75 share must never exceed the fee);
  `<= MAX_ORDER_TOTAL_KOBO`.
- **Persistence:** update `campus_zones.delivery_fee_kobo`.
- **Split unchanged:** rider settlement keeps paying `fulfiller_delivery_share_kobo` = ₦75. No
  change to the `orders` share columns, their CHECK constraints, or the order RPC for this feature.
  Consequence (accepted): when a zone fee ≠ ₦150, the recorded `platform_delivery_share_kobo`
  (₦75) understates the platform's actual net; payout math is unaffected because settlement uses
  the fulfiller share only. A future change can recompute the recorded platform share if reporting
  needs it — out of scope here.

### 2. Vendor-editable takeaway fee, admin-bounded

- **New column:** `vendors.service_fee_kobo integer null` (NULL → fall back to global
  `SERVICE_FEE_KOBO` default). Non-negative when set.
- **New column:** `campuses.max_service_fee_kobo integer not null default 20000` (non-negative) —
  the per-campus ceiling.
- **Admin endpoint:** `PATCH /admin/campuses/:campusId`, body `{ maxServiceFeeKobo: number }`.
  Campus-scoped for campus admins; super admins unrestricted. Validation: integer `>= 0`,
  `<= MAX_ORDER_TOTAL_KOBO`.
- **Vendor endpoint:** extend `PATCH /vendor/profile` (`UpdateVendorProfileDto`,
  `VendorProfileUpdateInput`, `VendorsService.updateProfile`) with optional `serviceFeeKobo`.
  Reject (`400`) if `serviceFeeKobo > campus.max_service_fee_kobo` for the vendor's campus.
  Setting `null`/omitting clears to the global default.
- **Quote + create:** `OrdersService.quoteOrder` and `createOrder` compute the effective service
  fee as `vendor.service_fee_kobo ?? SERVICE_FEE_KOBO` (clamped to the campus ceiling as a safety
  net) and pass it to the existing RPC `p_service_fee_kobo` param. `quoteOrder` currently reads
  `SERVICE_FEE_KOBO` directly (`orders.service.ts:57`); change it to read the vendor value. The
  repository quote/order path must surface the vendor's `service_fee_kobo` and the campus ceiling.

### 3. Max order total (₦2490)

- **New env:** `MAX_ORDER_TOTAL_KOBO` (`z.coerce.number().int().positive().default(249000)`) in
  `src/config/env.ts`.
- **Service layer:** in `OrdersService.createOrder`, after computing the quote/total, throw a clean
  `422` (`UnprocessableEntity`, existing error-code convention) when `totalKobo > MAX_ORDER_TOTAL_KOBO`,
  before any charge is initialised.
- **RPC defense-in-depth:** new migration recreating `create_pending_order_and_reserve_inventory`
  (same body as `20260625000400_order_service_fee.sql`) with an added guard after the total is
  computed: `if v_total > p_max_order_total_kobo then raise exception '...' using errcode = '23514'`.
  Add `p_max_order_total_kobo integer default 249000` as a new trailing param so the value is passed
  from config rather than hardcoded twice. Update the function comment and the drop signature.
- **Quote unchanged:** `quoteOrder` still returns the computed total (may exceed the cap); the create
  path is the enforcement point.

## Affected files (indicative)

- `supabase/migrations/<new>_admin_fee_config_order_cap.sql` — `vendors.service_fee_kobo`,
  `campuses.max_service_fee_kobo`, recreate order RPC with `p_max_order_total_kobo`.
- `src/config/env.ts` — `MAX_ORDER_TOTAL_KOBO`.
- `src/modules/admin/admin.controller.ts` / `admin.service.ts` / `admin.repository.ts` /
  `dto/admin.dto.ts` — zone delivery-fee + campus ceiling endpoints.
- `src/modules/vendors/` — `dto/vendor.dto.ts` (`UpdateVendorProfileDto`), `vendors.types.ts`,
  `vendors.service.ts`, `vendors.repository.ts` — `serviceFeeKobo` edit + ceiling check.
- `src/modules/orders/orders.service.ts` / `orders.repository.ts` / `orders.types.ts` — effective
  service fee from vendor, max-total guard, pass new RPC params.

## Testing

- **Unit:** delivery-fee validation bounds; service-fee ceiling clamp/reject; max-total guard
  (`domain` / service specs).
- **Integration:** `PATCH /admin/campus-zones/:zoneId` happy path + campus-scope forbidden;
  `PATCH /admin/campuses/:campusId` ceiling; `PATCH /vendor/profile` serviceFeeKobo accept/reject;
  order create rejected over ₦2490; quote still returns over-cap total.
- **DB (pgTAP):** RPC rejects total > cap; vendor service fee flows into `orders.service_fee_kobo`.

## Out of scope (YAGNI)

- Restructuring the 75/75 delivery split or adding a separate Paystack-fee line.
- Recomputing recorded `platform_delivery_share_kobo` for non-₦150 fees.
- Backfill of historic orders.
- Per-zone or time-based takeaway fees.
