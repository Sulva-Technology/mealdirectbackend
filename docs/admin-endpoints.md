# Meal Direct Backend — Admin API Endpoint Reference

> Request input, validation rules, and response schemas.
> **Base path:** `/v1/admin` • Generated 2026-06-23

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Session & Dashboard](#2-session--dashboard)
3. [Orders](#3-orders)
4. [Delivery Batches](#4-delivery-batches)
5. [Vendors](#5-vendors)
6. [Riders](#6-riders)
7. [Inventory](#7-inventory)
8. [Escalations](#8-escalations)
9. [Settlements](#9-settlements)
10. [Reviews](#10-reviews)
11. [Users](#11-users)
12. [Admin Memberships](#12-admin-memberships)
13. [Analytics & Audit Logs](#13-analytics--audit-logs)

---

## 1. Conventions

### 1.1 Authentication & authorization

Every admin route requires a valid Supabase JWT in the `Authorization: Bearer <token>` header.
Guards: `JwtAuthGuard` + `RolesGuard`. Controller-level role gate: `@RequireRoles('campus_admin', 'super_admin')`.

| Field            | Type | Required | Constraints / Notes                                                                         |
| ---------------- | ---- | -------- | ------------------------------------------------------------------------------------------- |
| Role scope       | n/a  | yes      | `campus_admin` → scoped to own `campusId`; `super_admin` → global, may pass any `campusId`. |
| 401 Unauthorized | n/a  | n/a      | Missing, invalid, or expired Supabase JWT.                                                  |
| 403 Forbidden    | n/a  | n/a      | Admin role required; `campus_admin` requesting another campus; super-admin-only routes.     |

> Super-admin-only routes: user suspend/activate, all `/admin-memberships` routes.

### 1.2 Response envelopes

Single-object responses are wrapped in a success envelope:

| Field  | Type              | Description                                      |
| ------ | ----------------- | ------------------------------------------------ |
| `data` | object            | The resource record (shape varies per endpoint). |
| `meta` | object (optional) | Present only when extra metadata is attached.    |

List responses are wrapped in a list envelope:

| Field        | Type              | Description                                   |
| ------------ | ----------------- | --------------------------------------------- |
| `data`       | array\<object>    | Array of resource records.                    |
| `pagination` | object            | Cursor pagination metadata (see 1.3).         |
| `meta`       | object (optional) | Present only when extra metadata is attached. |

### 1.3 Pagination metadata

`pagination` object on every list envelope:

| Field        | Type              | Description                                                                                                                              |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `hasMore`    | boolean           | True when more rows exist beyond this page.                                                                                              |
| `limit`      | number            | Page size actually applied (default 20, max 100).                                                                                        |
| `nextCursor` | string (optional) | Opaque base64url cursor; omitted when `hasMore` is false. Note: cursor not emitted by current admin list queries (offset-style limit+1). |

### 1.4 Cursor query params (shared by paginated lists)

| Field    | Type   | Required | Constraints / Notes        |
| -------- | ------ | -------- | -------------------------- |
| `cursor` | string | no       | Opaque pagination cursor.  |
| `limit`  | number | no       | Integer 1–100. Default 20. |

### 1.5 Common value formats

| Field      | Type             | Description                                                         |
| ---------- | ---------------- | ------------------------------------------------------------------- |
| `date`     | string           | ISO calendar date, pattern `^\d{4}-\d{2}-\d{2}$` (e.g. 2026-06-23). |
| `uuid`     | string           | Database UUID.                                                      |
| `*Kobo`    | number (integer) | Money amount in kobo (1/100 NGN).                                   |
| timestamps | string           | ISO-8601 datetime text (`createdAt`, `updatedAt`, etc.).            |

### 1.6 Error response shape

Errors return non-2xx with a JSON body:

| Field     | Type   | Description                                         |
| --------- | ------ | --------------------------------------------------- |
| `code`    | string | e.g. `FORBIDDEN`, `VALIDATION_FAILED`, `NOT_FOUND`. |
| `message` | string | Human-readable detail.                              |

---

## 2. Session & Dashboard

### `GET /v1/admin/session`

Authenticated admin session and scope. **Access:** campus_admin, super_admin

**Response** — 200 OK, success envelope `{ data }`

| Field      | Type              | Description                                                                   |
| ---------- | ----------------- | ----------------------------------------------------------------------------- |
| `userId`   | string            | Authenticated admin user id.                                                  |
| `role`     | string            | `campus_admin` or `super_admin`.                                              |
| `campusId` | string \| null    | Campus scope (null for global super admin).                                   |
| `email`    | string (optional) | Present when known from the token.                                            |
| `scopes`   | array\<string>    | `['admin:global']` for super_admin; `['admin:campus:<id>']` for campus_admin. |

### `GET /v1/admin/dashboard`

Admin operational dashboard for a service date. **Access:** campus_admin, super_admin

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                                        |
| ---------- | ------ | -------- | ---------------------------------------------------------- |
| `campusId` | uuid   | no       | Filter by campus. `campus_admin` restricted to own campus. |
| `date`     | string | no       | Service date (YYYY-MM-DD). Defaults to today.              |

**Response** — 200 OK, success envelope `{ data }`

| Field         | Type           | Description                                   |
| ------------- | -------------- | --------------------------------------------- |
| `date`        | string         | Service date used.                            |
| `campusId`    | string \| null | Campus scope applied.                         |
| `orders`      | object         | `{ total: number, paid: number }`.            |
| `batches`     | object         | `{ total: number, open: number }`.            |
| `payments`    | object         | `{ total: number, failed: number }`.          |
| `escalations` | object         | `{ open: number }`.                           |
| `settlements` | object         | `{ payableKobo: number }` (draft + approved). |
| `alerts`      | array\<object> | Currently always empty `[]`.                  |

---

## 3. Orders

**Shared list fields:** `id`, `orderNumber`, `customerId`, `campusId`, `vendorId`, `vendorDisplayName`, `serviceDate`, `deliverySlotId`, `locationId`, `orderStatus`, `deliveryMode`, `totalKobo`, `currency`, `createdAt`, `updatedAt`.

**Shared get fields:** `id`, `orderNumber`, `customerId`, `customerEmail` (string \| null), `campusId`, `vendorId`, `vendorDisplayName`, `orderStatus`, `deliveryMode`, `serviceDate`, `totalKobo`, `currency`, `createdAt`, `updatedAt`.

### `GET /v1/admin/orders`

List orders (filtered, paginated).

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                                                                                                                                          |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cursor`   | string | no       | Pagination cursor.                                                                                                                                           |
| `limit`    | number | no       | Integer 1–100, default 20.                                                                                                                                   |
| `campusId` | uuid   | no       | Filter by campus.                                                                                                                                            |
| `status`   | string | no       | One of: accepted, administratively_completed, cancelled, confirmed, delivered, expired, out_for_delivery, paid, pending_payment, preparing, ready, refunded. |
| `vendorId` | uuid   | no       | Filter by vendor.                                                                                                                                            |
| `slotId`   | uuid   | no       | Filter by delivery slot.                                                                                                                                     |
| `date`     | string | no       | Service date (YYYY-MM-DD).                                                                                                                                   |
| `search`   | string | no       | Max 120 chars; matches `orderNumber` (ilike).                                                                                                                |

**Response** — 200 OK, list envelope `{ data[], pagination }` (order list fields).

### `GET /v1/admin/orders/:orderId`

Get a single order.

**Path parameters:** `orderId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (order get fields).

> 404 NOT_FOUND if the order is not found / outside campus scope.

### `POST /v1/admin/orders/:orderId/cancel`

Cancel an order (admin).

**Path parameters:** `orderId` (uuid, yes).

**Request body (application/json)**

| Field    | Type   | Required | Constraints / Notes                                                                       |
| -------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `reason` | string | no       | Max 500 chars. Defaults to "Cancelled by admin." Drives a status transition to cancelled. |

**Response** — 200 OK, success envelope `{ data }` (order record).

### `POST /v1/admin/orders/:orderId/status-transition`

Transition order status.

**Path parameters:** `orderId` (uuid, yes).

**Request body (application/json)**

| Field    | Type   | Required | Constraints / Notes                                      |
| -------- | ------ | -------- | -------------------------------------------------------- |
| `status` | string | yes      | Target order status (same enum as list `status` filter). |
| `reason` | string | no       | Max 500 chars.                                           |

**Response** — 200 OK, success envelope `{ data }` (order record).

> 400 VALIDATION_FAILED if the DB transition function rejects the change.

---

## 4. Delivery Batches

**Shared list fields:** `id`, `campusId`, `vendorId`, `vendorDisplayName`, `serviceDate`, `deliverySlotId`, `zoneId`, `batchNumber`, `status`, `deliveryMode`, `orderCount`, `deliveryEarningsKobo`, `createdAt`, `updatedAt`.

**Shared get fields:** list fields minus `deliverySlotId`/`zoneId`, plus `assignmentId` (string \| null), `riderId` (string \| null), `assignmentStatus` (string \| null).

Batch `status` enum: open, closed, assigned, in_progress, completed, cancelled.

### `GET /v1/admin/batches`

List delivery batches.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                                        |
| ---------- | ------ | -------- | ---------------------------------------------------------- |
| `cursor`   | string | no       | Pagination cursor.                                         |
| `limit`    | number | no       | Integer 1–100, default 20.                                 |
| `campusId` | uuid   | no       | Filter by campus.                                          |
| `date`     | string | no       | Service date (YYYY-MM-DD).                                 |
| `status`   | string | no       | open, closed, assigned, in_progress, completed, cancelled. |
| `vendorId` | uuid   | no       | Filter by vendor.                                          |
| `zoneId`   | uuid   | no       | Filter by zone.                                            |

**Response** — 200 OK, list envelope `{ data[], pagination }` (batch list fields).

### `GET /v1/admin/batches/:batchId`

Get a single batch (with assignment). **Path:** `batchId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (batch get fields). 404 NOT_FOUND if not found / outside scope.

### `POST /v1/admin/batches/:batchId/close`

Close a batch. **Path:** `batchId` (uuid, yes). No request body.

**Response** — 200 OK, success envelope `{ data }` (batch record).

### `POST /v1/admin/batches/:batchId/assign-rider`

Assign a rider to a batch. **Path:** `batchId` (uuid, yes).

**Body:** `riderId` (uuid, yes) — Rider to assign.

**Response** — 200 OK, success envelope `{ data }` (batch record).

### `POST /v1/admin/batches/:batchId/assign-vendor-delivery`

Assign vendor self-delivery to a batch. **Path:** `batchId` (uuid, yes).

**Body:** `vendorId` (uuid, yes) — Vendor that will self-deliver.

**Response** — 200 OK, success envelope `{ data }` (batch record).

### `POST /v1/admin/batches/:batchId/reassign-rider`

Reassign batch to a different rider. **Path:** `batchId` (uuid, yes).

**Body:** `riderId` (uuid, yes) — New rider.

**Response** — 200 OK, success envelope `{ data }` (batch record).

### `POST /v1/admin/batches/:batchId/cancel-assignment`

Cancel the current batch assignment. **Path:** `batchId` (uuid, yes). No request body.

**Response** — 200 OK, success envelope `{ data }` (batch record).

---

## 5. Vendors

**Shared list fields:** `id`, `campusId`, `legalName`, `displayName`, `slug`, `status`, `active`, `phone` (string \| null), `email` (string \| null), `createdAt`, `updatedAt`.

**Shared get fields:** list fields plus `description` (string \| null); `phone`/`email` nullable.

Vendor `status` enum: approved, deactivated, pending, suspended.

### `GET /v1/admin/vendors`

List vendors.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                                  |
| ---------- | ------ | -------- | ---------------------------------------------------- |
| `cursor`   | string | no       | Pagination cursor.                                   |
| `limit`    | number | no       | Integer 1–100, default 20.                           |
| `campusId` | uuid   | no       | Filter by campus.                                    |
| `search`   | string | no       | Max 120 chars; matches `displayName` or `legalName`. |
| `status`   | string | no       | approved, deactivated, pending, suspended.           |

**Response** — 200 OK, list envelope `{ data[], pagination }` (vendor list fields).

### `POST /v1/admin/vendors`

Create a vendor.

**Request body (application/json)**

| Field         | Type   | Required | Constraints / Notes                                   |
| ------------- | ------ | -------- | ----------------------------------------------------- |
| `campusId`    | uuid   | yes      | Owning campus.                                        |
| `legalName`   | string | yes      | 2–160 chars.                                          |
| `displayName` | string | yes      | 2–120 chars.                                          |
| `slug`        | string | yes      | Lowercase slug, pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |

**Response** — 201 Created, success envelope `{ data }`

| Field         | Type    | Description     |
| ------------- | ------- | --------------- |
| `id`          | string  | New vendor id.  |
| `campusId`    | string  | Campus id.      |
| `legalName`   | string  | Legal name.     |
| `displayName` | string  | Display name.   |
| `slug`        | string  | Slug.           |
| `status`      | string  | Initial status. |
| `active`      | boolean | Active flag.    |

### `GET /v1/admin/vendors/:vendorId`

Get a vendor. **Path:** `vendorId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (vendor get fields).

### `PATCH /v1/admin/vendors/:vendorId`

Update vendor fields. **Path:** `vendorId` (uuid, yes).

**Request body (application/json)**

| Field         | Type    | Required | Constraints / Notes |
| ------------- | ------- | -------- | ------------------- |
| `displayName` | string  | no       | Max 120 chars.      |
| `description` | string  | no       | Max 1000 chars.     |
| `phone`       | string  | no       | Phone.              |
| `active`      | boolean | no       | Active flag.        |

**Response** — 200 OK, success envelope `{ data }` (vendor record).

### `POST /v1/admin/vendors/:vendorId/approve`

Approve a vendor (status=approved, active=true). **Path:** `vendorId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (vendor record).

### `POST /v1/admin/vendors/:vendorId/suspend`

Suspend a vendor (status=suspended). **Path:** `vendorId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (vendor record).

### `POST /v1/admin/vendors/:vendorId/activate`

Activate a vendor (alias of approve). **Path:** `vendorId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (vendor record).

### `POST /v1/admin/vendors/:vendorId/users`

Add or upsert a vendor user. **Path:** `vendorId` (uuid, yes).

**Request body (application/json)**

| Field    | Type   | Required | Constraints / Notes |
| -------- | ------ | -------- | ------------------- |
| `userId` | uuid   | yes      | User to attach.     |
| `role`   | string | yes      | `owner` or `staff`. |

**Response** — 201 Created, success envelope `{ data }`

| Field      | Type    | Description     |
| ---------- | ------- | --------------- |
| `id`       | string  | Vendor-user id. |
| `vendorId` | string  | Vendor id.      |
| `userId`   | string  | User id.        |
| `role`     | string  | owner or staff. |
| `active`   | boolean | Active flag.    |

### `GET /v1/admin/vendors/:vendorId/performance`

Vendor performance summary. **Path:** `vendorId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }`

| Field                 | Type           | Description            |
| --------------------- | -------------- | ---------------------- |
| `orderCount`          | number         | Total orders.          |
| `grossSalesKobo`      | number         | Gross sales in kobo.   |
| `reviewCount`         | number         | Number of reviews.     |
| `averageVendorRating` | number \| null | Average vendor rating. |

> Returns `{}` if the vendor has no aggregate row.

---

## 6. Riders

**Shared list fields:** `id`, `campusId`, `userId`, `displayName`, `phone` (string \| null), `status`, `active`, `verifiedAt` (string \| null), `createdAt`. **Get** adds `updatedAt`.

Rider `status` enum: deactivated, pending, suspended, verified.

### `GET /v1/admin/riders`

List riders.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                        |
| ---------- | ------ | -------- | ------------------------------------------ |
| `cursor`   | string | no       | Pagination cursor.                         |
| `limit`    | number | no       | Integer 1–100, default 20.                 |
| `campusId` | uuid   | no       | Filter by campus.                          |
| `search`   | string | no       | Max 120 chars; matches `displayName`.      |
| `status`   | string | no       | deactivated, pending, suspended, verified. |

**Response** — 200 OK, list envelope `{ data[], pagination }` (rider list fields).

### `GET /v1/admin/riders/:riderId`

Get a rider. **Path:** `riderId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (rider get fields).

### `GET /v1/admin/riders/:riderId/assignments`

List a rider's delivery assignments (max 100). **Path:** `riderId` (uuid, yes).

**Response** — 200 OK, list envelope `{ data[], pagination }` (hasMore=false, limit=count)

| Field               | Type           | Description          |
| ------------------- | -------------- | -------------------- |
| `id`                | string         | Assignment id.       |
| `batchId`           | string         | Batch id.            |
| `riderId`           | string         | Rider id.            |
| `status`            | string         | Assignment status.   |
| `assignedAt`        | string \| null | Assigned timestamp.  |
| `acceptedAt`        | string \| null | Accepted timestamp.  |
| `pickedUpAt`        | string \| null | Picked-up timestamp. |
| `completedAt`       | string \| null | Completed timestamp. |
| `campusId`          | string         | Campus id.           |
| `vendorId`          | string         | Vendor id.           |
| `vendorDisplayName` | string         | Vendor display name. |
| `serviceDate`       | string         | Service date.        |
| `batchNumber`       | string         | Batch number.        |
| `orderCount`        | number         | Orders in batch.     |

### `GET /v1/admin/riders/:riderId/settlements`

List a rider's settlements (max 100). **Path:** `riderId` (uuid, yes).

**Response** — 200 OK, list envelope `{ data[], pagination }` (hasMore=false)

| Field                  | Type           | Description                       |
| ---------------------- | -------------- | --------------------------------- |
| `id`                   | string         | Settlement id.                    |
| `campusId`             | string         | Campus id.                        |
| `riderId`              | string         | Rider id.                         |
| `settlementDate`       | string         | Settlement date.                  |
| `status`               | string         | draft, approved, paid, cancelled. |
| `deliveryEarningsKobo` | number         | Delivery earnings in kobo.        |
| `adjustmentsKobo`      | number         | Adjustments in kobo.              |
| `payableKobo`          | number         | Payable in kobo.                  |
| `paidAt`               | string \| null | Paid timestamp.                   |
| `externalReference`    | string \| null | External payment reference.       |
| `createdAt`            | string         | Created timestamp.                |

### `POST /v1/admin/riders/:riderId/verify`

Verify a rider (status=verified, active=true). **Path:** `riderId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (rider record).

### `POST /v1/admin/riders/:riderId/suspend`

Suspend a rider (status=suspended). **Path:** `riderId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (rider record).

### `POST /v1/admin/riders/:riderId/activate`

Activate a rider (alias of verify). **Path:** `riderId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (rider record).

---

## 7. Inventory

### `GET /v1/admin/inventory`

List menu item inventory (max 100).

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                                 |
| ---------- | ------ | -------- | --------------------------------------------------- |
| `campusId` | uuid   | no       | Filter by campus.                                   |
| `date`     | string | no       | Service date (YYYY-MM-DD).                          |
| `slotId`   | uuid   | no       | Filter by delivery slot.                            |
| `vendorId` | uuid   | no       | Filter by vendor.                                   |
| `state`    | string | no       | available (remaining>5), low (1–5), sold_out (<=0). |

**Response** — 200 OK, list envelope `{ data[], pagination }` (hasMore=false)

| Field               | Type   | Description                         |
| ------------------- | ------ | ----------------------------------- |
| `id`                | string | Inventory row id.                   |
| `vendorId`          | string | Vendor id.                          |
| `campusId`          | string | Campus id.                          |
| `menuItemName`      | string | Menu item name.                     |
| `serviceDate`       | string | Service date.                       |
| `deliverySlotId`    | string | Delivery slot id.                   |
| `quantityTotal`     | number | Total quantity.                     |
| `quantityReserved`  | number | Reserved quantity.                  |
| `quantitySold`      | number | Sold quantity.                      |
| `quantityAdjusted`  | number | Adjusted quantity.                  |
| `remainingQuantity` | number | total + adjusted - reserved - sold. |

### `POST /v1/admin/inventory/:inventoryId/adjustments`

Record an inventory adjustment. **Path:** `inventoryId` (uuid, yes).

**Request body (application/json)**

| Field    | Type             | Required | Constraints / Notes       |
| -------- | ---------------- | -------- | ------------------------- |
| `delta`  | number (integer) | yes      | Signed adjustment amount. |
| `reason` | string           | yes      | 3–200 chars.              |

**Response** — 201 Created, success envelope `{ data }`

| Field          | Type   | Description                                            |
| -------------- | ------ | ------------------------------------------------------ |
| `adjustmentId` | string | Created adjustment id (`record_inventory_adjustment`). |

---

## 8. Escalations

**Shared list fields:** `id`, `orderId`, `campusId`, `openedBy`, `category`, `description`, `status`, `assignedAdminId` (string \| null), `openedAt`.

**Shared get fields:** `id`, `orderId`, `campusId`, `category`, `description`, `status`, `resolution` (string \| null), `assignedAdminId` (string \| null), `refundId` (string \| null), `openedAt`, `resolvedAt` (string \| null).

Escalation `status` enum: open, investigating, resolved, rejected.

### `GET /v1/admin/escalations`

List escalations.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                      |
| ---------- | ------ | -------- | ---------------------------------------- |
| `cursor`   | string | no       | Pagination cursor.                       |
| `limit`    | number | no       | Integer 1–100, default 20.               |
| `campusId` | uuid   | no       | Filter by campus.                        |
| `status`   | string | no       | open, investigating, resolved, rejected. |
| `category` | string | no       | Filter by category.                      |
| `assignee` | string | no       | Filter by assignee (accepted; see note). |

**Response** — 200 OK, list envelope `{ data[], pagination }` (escalation list fields).

> `assignee` query param is accepted/validated but not applied in the current query.

### `GET /v1/admin/escalations/:id`

Get an escalation. **Path:** `id` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (escalation get fields).

### `POST /v1/admin/escalations/:id/assign`

Assign escalation to an admin (status→investigating). **Path:** `id` (uuid, yes).

**Body:** `adminUserId` (uuid, yes) — Admin user to assign.

**Response** — 200 OK, success envelope `{ data }` (escalation record).

### `POST /v1/admin/escalations/:id/request-evidence`

Request evidence (status→investigating). **Path:** `id` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (escalation record).

### `POST /v1/admin/escalations/:id/resolve`

Resolve escalation (status→resolved). **Path:** `id` (uuid, yes).

**Body:** `resolution` (string, yes) — 3–1000 chars.

**Response** — 200 OK, success envelope `{ data }` (escalation record).

### `POST /v1/admin/escalations/:id/refunds`

Mark escalation refunded (status→resolved). **Path:** `id` (uuid, yes). No body.

**Response** — 201 Created, success envelope `{ data }` (escalation record).

---

## 9. Settlements

**Shared list fields:** `id`, `campusId`, `vendorId` (string \| null), `riderId` (string \| null), `settlementDate`, `status`, `payableKobo`, `paidAt` (string \| null), `externalReference` (string \| null), `createdAt`.

**Shared get fields:** `id`, `campusId`, `vendorId` (string \| null), `riderId` (string \| null), `settlementDate`, `status`, `grossFoodAmountKobo`, `deliveryEarningsKobo`, `refundsKobo`, `adjustmentsKobo`, `payableKobo`, `paidAt` (string \| null), `externalReference` (string \| null).

Settlement `status` enum: draft, approved, paid, cancelled.

### `GET /v1/admin/settlements`

List settlements.

**Query parameters**

| Field             | Type   | Required | Constraints / Notes               |
| ----------------- | ------ | -------- | --------------------------------- |
| `cursor`          | string | no       | Pagination cursor.                |
| `limit`           | number | no       | Integer 1–100, default 20.        |
| `campusId`        | uuid   | no       | Filter by campus.                 |
| `date`            | string | no       | Settlement date (YYYY-MM-DD).     |
| `status`          | string | no       | approved, cancelled, draft, paid. |
| `beneficiaryType` | string | no       | rider or vendor.                  |

**Response** — 200 OK, list envelope `{ data[], pagination }` (settlement list fields).

### `POST /v1/admin/settlements/preview`

Preview a settlement (no write).

**Request body (application/json)**

| Field             | Type   | Required | Constraints / Notes |
| ----------------- | ------ | -------- | ------------------- |
| `beneficiaryType` | string | yes      | rider or vendor.    |
| `beneficiaryId`   | uuid   | yes      | Vendor or rider id. |
| `settlementDate`  | string | yes      | Date (YYYY-MM-DD).  |

**Response** — 200 OK, success envelope `{ data }`

| Field                  | Type   | Description                     |
| ---------------------- | ------ | ------------------------------- |
| `beneficiaryType`      | string | Echoed type.                    |
| `beneficiaryId`        | string | Echoed id.                      |
| `settlementDate`       | string | Echoed date.                    |
| `grossFoodAmountKobo`  | number | Vendor only: gross food amount. |
| `deliveryEarningsKobo` | number | Delivery earnings in kobo.      |
| `refundsKobo`          | number | Vendor only: refunds in kobo.   |
| `estimatedPayableKobo` | number | Estimated payable in kobo.      |

> Rider preview returns `beneficiaryType`/`Id`/`Date`, `deliveryEarningsKobo`, `estimatedPayableKobo`. Returns `{}` if no aggregate row.

### `POST /v1/admin/settlements/generate`

Generate (persist) a settlement.

**Request body (application/json)**

| Field             | Type   | Required | Constraints / Notes |
| ----------------- | ------ | -------- | ------------------- |
| `beneficiaryType` | string | yes      | rider or vendor.    |
| `beneficiaryId`   | uuid   | yes      | Vendor or rider id. |
| `settlementDate`  | string | yes      | Date (YYYY-MM-DD).  |

**Response** — 201 Created, success envelope `{ data }`

| Field          | Type   | Description                                           |
| -------------- | ------ | ----------------------------------------------------- |
| `settlementId` | string | Created settlement id (`produce_*_daily_settlement`). |

### `GET /v1/admin/settlements/:id`

Get a settlement. **Path:** `id` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (settlement get fields).

### `POST /v1/admin/settlements/:id/approve`

Approve a settlement (status=approved). **Path:** `id` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (settlement record).

### `POST /v1/admin/settlements/:id/mark-paid`

Mark settlement paid. **Path:** `id` (uuid, yes).

**Body:** `externalReference` (string, yes) — 3–120 chars; external payment reference.

**Response** — 200 OK, success envelope `{ data }` (settlement record).

### `POST /v1/admin/settlements/:id/adjustments`

Add a settlement adjustment line. **Path:** `id` (uuid, yes).

**Request body (application/json)**

| Field         | Type             | Required | Constraints / Notes               |
| ------------- | ---------------- | -------- | --------------------------------- |
| `amountKobo`  | number (integer) | yes      | Signed adjustment amount in kobo. |
| `description` | string           | yes      | 3–200 chars.                      |

**Response** — 201 Created, success envelope `{ data }` (settlement record).

---

## 10. Reviews

### `GET /v1/admin/reviews`

List reviews.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                               |
| ---------- | ------ | -------- | ------------------------------------------------- |
| `cursor`   | string | no       | Pagination cursor.                                |
| `limit`    | number | no       | Integer 1–100, default 20.                        |
| `campusId` | uuid   | no       | Filter by campus.                                 |
| `status`   | string | no       | approved, pending, rejected.                      |
| `rating`   | number | no       | Integer 1–5; matches food/vendor/delivery rating. |
| `vendorId` | uuid   | no       | Filter by vendor.                                 |

**Response** — 200 OK, list envelope `{ data[], pagination }`

| Field              | Type           | Description                  |
| ------------------ | -------------- | ---------------------------- |
| `id`               | string         | Review id.                   |
| `orderId`          | string         | Order id.                    |
| `campusId`         | string         | Campus id.                   |
| `vendorId`         | string         | Vendor id.                   |
| `foodRating`       | number \| null | Food rating.                 |
| `vendorRating`     | number \| null | Vendor rating.               |
| `deliveryRating`   | number \| null | Delivery rating.             |
| `comment`          | string \| null | Comment.                     |
| `moderationStatus` | string         | approved, pending, rejected. |
| `createdAt`        | string         | Created timestamp.           |

### `POST /v1/admin/reviews/:reviewId/moderate`

Moderate a review. **Path:** `reviewId` (uuid, yes).

**Body:** `status` (string, yes) — approved, pending, rejected.

**Response** — 201 Created, success envelope `{ data }`

| Field              | Type   | Description            |
| ------------------ | ------ | ---------------------- |
| `id`               | string | Review id.             |
| `moderationStatus` | string | New moderation status. |

---

## 11. Users

**Shared fields:** `id`, `displayName`, `email` (string \| null), `phoneNumber` (string \| null), `accountStatus`, `defaultCampusId` (string \| null), `createdAt`.

Account `status` enum: active, suspended, deactivated.

### `GET /v1/admin/users`

List users.

**Query parameters**

| Field      | Type   | Required | Constraints / Notes                              |
| ---------- | ------ | -------- | ------------------------------------------------ |
| `cursor`   | string | no       | Pagination cursor.                               |
| `limit`    | number | no       | Integer 1–100, default 20.                       |
| `campusId` | uuid   | no       | Filter by campus.                                |
| `search`   | string | no       | Max 120 chars; matches `email` or `displayName`. |
| `status`   | string | no       | active, suspended, deactivated.                  |

**Response** — 200 OK, list envelope `{ data[], pagination }` (user fields).

### `GET /v1/admin/users/:userId`

Get a user. **Path:** `userId` (uuid, yes).

**Response** — 200 OK, success envelope `{ data }` (user fields).

### `POST /v1/admin/users/:userId/suspend`

Suspend a user. **Access: super_admin only.** **Path:** `userId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (user record).

### `POST /v1/admin/users/:userId/activate`

Activate a user. **Access: super_admin only.** **Path:** `userId` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (user record).

---

## 12. Admin Memberships

> All routes in this section require **super_admin**.

**Shared fields:** `id`, `userId`, `campusId` (string \| null), `role` (campus_admin or super_admin), `active`.

### `GET /v1/admin/admin-memberships`

List all admin memberships. **Access: super_admin only.**

**Response** — 200 OK, list envelope `{ data[], pagination }` (hasMore=false)

| Field       | Type           | Description                       |
| ----------- | -------------- | --------------------------------- |
| `id`        | string         | Membership id.                    |
| `userId`    | string         | User id.                          |
| `campusId`  | string \| null | Campus id (null for super_admin). |
| `role`      | string         | campus_admin or super_admin.      |
| `active`    | boolean        | Active flag.                      |
| `grantedAt` | string         | Granted timestamp.                |
| `revokedAt` | string \| null | Revoked timestamp.                |

### `POST /v1/admin/admin-memberships`

Create an admin membership. **Access: super_admin only.**

**Request body (application/json)**

| Field      | Type   | Required | Constraints / Notes                                             |
| ---------- | ------ | -------- | --------------------------------------------------------------- |
| `userId`   | uuid   | yes      | User to grant.                                                  |
| `role`     | string | yes      | campus_admin or super_admin.                                    |
| `campusId` | uuid   | no       | Required when role = campus_admin (else 400 VALIDATION_FAILED). |

**Response** — 201 Created, success envelope `{ data }` (membership fields).

### `POST /v1/admin/admin-memberships/:id/revoke`

Revoke a membership (active=false). **Access: super_admin only.** **Path:** `id` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (membership fields).

### `POST /v1/admin/admin-memberships/:id/activate`

Re-activate a membership (active=true). **Access: super_admin only.** **Path:** `id` (uuid, yes). No body.

**Response** — 200 OK, success envelope `{ data }` (membership fields).

---

## 13. Analytics & Audit Logs

### `GET /v1/admin/analytics`

Aggregate order analytics.

**Query parameters**

| Field         | Type   | Required | Constraints / Notes                                        |
| ------------- | ------ | -------- | ---------------------------------------------------------- |
| `campusId`    | uuid   | no       | Filter by campus.                                          |
| `dateFrom`    | string | no       | Start service date (YYYY-MM-DD).                           |
| `dateTo`      | string | no       | End service date (YYYY-MM-DD).                             |
| `granularity` | string | no       | day, week, month (accepted; not applied in current query). |

**Response** — 200 OK, success envelope `{ data }`

| Field               | Type   | Description                   |
| ------------------- | ------ | ----------------------------- |
| `orderCount`        | number | Order count in range.         |
| `grossSalesKobo`    | number | Gross sales in kobo.          |
| `activeVendorCount` | number | Distinct vendors with orders. |

> Returns `{}` if no rows.

### `GET /v1/admin/audit-logs`

List audit logs.

**Query parameters**

| Field        | Type   | Required | Constraints / Notes        |
| ------------ | ------ | -------- | -------------------------- |
| `cursor`     | string | no       | Pagination cursor.         |
| `limit`      | number | no       | Integer 1–100, default 20. |
| `campusId`   | uuid   | no       | Filter by campus.          |
| `actorId`    | uuid   | no       | Filter by acting user.     |
| `action`     | string | no       | Filter by action.          |
| `entityType` | string | no       | Filter by entity type.     |
| `entityId`   | uuid   | no       | Filter by entity id.       |
| `requestId`  | string | no       | Filter by request id.      |

**Response** — 200 OK, list envelope `{ data[], pagination }`

| Field         | Type           | Description        |
| ------------- | -------------- | ------------------ |
| `id`          | string         | Audit log id.      |
| `actorUserId` | string \| null | Acting user id.    |
| `campusId`    | string \| null | Campus id.         |
| `action`      | string         | Action name.       |
| `entityType`  | string         | Entity type.       |
| `entityId`    | string \| null | Entity id.         |
| `requestId`   | string \| null | Request id.        |
| `createdAt`   | string         | Created timestamp. |
