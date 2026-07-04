# User management & auth fixes — design

Date: 2026-07-04
Status: approved (pending spec review)

Four related items on the identity/auth surface:

1. Vendor login must honor `vendor_users` membership, not only `app_metadata` role.
2. Password reset and confirmation resend must redirect to the correct portal.
3. A super_admin endpoint to delete any user (all user types), cascade-removing the record.
4. Diagnose + fix admin (campus_admin) login returning `auth_failed` "Invalid login
   credentials" for a user whose credentials are correct.
5. Document how the admin UI creates an admin (uses the existing endpoint; no new
   backend). Included so the flow is clear and not done by hand-editing tables.

---

## Fix 1 — vendor login honors `vendor_users` membership

### Problem

`POST /auth/vendor/login` calls `signIn(email, password, ['vendor'])`. `signIn`
resolves the user's role solely from `app_metadata.meal_direct_role` (falling back
to `app_metadata.role` / `user_metadata.meal_direct_role`, else `customer`) and
rejects with `ForbiddenException` "Invalid credentials or incorrect role." when the
role is not in `allowedRoles`.

The admin "Add Vendor User" flow (`POST /admin/vendors/:vendorId/users`) inserts only
into `public.vendor_users`; it never changes the target user's `app_metadata`. So a
user added as vendor staff/owner still carries their original role (`admin`,
`customer`, etc.) and vendor login rejects them. Membership is never consulted at
login. The error message is also misleading — credentials were valid, only the role
gate failed.

### Design

**Already implemented in the codebase.** `signIn` already routes a role-mismatch through
`resolveGrantForLogin`, whose vendor branch calls
`AuthRoleGrantsRepository.findVendorGrantForUser` — which reads
`public.vendor_users where active` and, when a membership exists, syncs the user's
`app_metadata` to `meal_direct_role: 'vendor'` (+ `vendor_id`) and refreshes the session.
So a user added via "Add Vendor User" can already sign in to the vendor portal. (Note:
this grant path *does* set app_metadata to vendor, which is what makes the vendor JWT
claim and vendor-scoped endpoints work; a user is single-role in the JWT by design.)

The only remaining change for this item:

- Correct the misleading role-gate error message from
  "Invalid credentials or incorrect role." to
  "Your account is not permitted to sign in to this portal." so a valid credential on the
  wrong portal is not reported as a bad credential.

### Notes / trade-offs

- The reported "invalid credentials" when adding a UID is therefore **not** a missing
  membership check — it is the pre-auth Supabase rejection covered by Fix 4 (bad
  password / user absent from the API's project / wrong UUID). Adding a UUID to
  `vendor_users` never creates an Auth user.

---

## Fix 2 — per-portal password reset & confirmation resend

### Problem

`requestPasswordReset` and `resendConfirmation` hardcode `authRedirectUrl('customer')`,
so vendor/rider/admin users who request a reset are redirected to the customer
front-end.

### Design

- Add optional `portal?: 'customer' | 'vendor' | 'rider' | 'admin'` to
  `EmailRequestDto` (validated enum, default `customer`).
- `requestPasswordReset(email, portal = 'customer')` and
  `resendConfirmation(email, portal = 'customer')` pass `authRedirectUrl(portal)`.
- Extend `appBaseUrlForRole` with an `admin` case returning `APP_URL_ADMIN`; add
  `APP_URL_ADMIN` to `EnvService` config and `.env` examples.
- Endpoints remain non-enumerating: still swallow provider errors and return the same
  generic message regardless of account existence.
- Controllers pass `dto.portal` through; response messages unchanged.

---

## Fix 3 — `DELETE /admin/users/:userId` (super_admin, all user types)

### Behavior (decided)

Super_admin can delete **any** user regardless of type (customer, vendor staff/owner,
rider, admin). The intent was a full cascade delete, but the database forbids hard-delete
for users with append-only history (see "Hard-delete is impossible" below). The endpoint
therefore uses an auto-detected **hybrid**: a pristine user is fully hard-deleted; a user
with history is anonymized (PII scrubbed, roles deactivated) and banned from login. The
outcome (`deleted` | `anonymized`) is returned. Cascade-everything and soft-delete-only
were both considered and rejected in favor of this.

### Endpoint

- `DELETE /admin/users/:userId` on the admin controller.
- Guard: `@RequirePermission('admin:manage')` — only super_admin holds `admin:manage`, so
  campus_admin is excluded — plus a service-layer `assertSuperAdmin`.
- Guard: an actor may not delete their own account → `400` with a clear message.
- `404` if the user id has no profile.

### Service — `AdminService.deleteUser(actor, userId)`

1. Reject self-deletion.
2. Load a snapshot of the target (id, email, base role, and counts of dependent rows)
   for the audit record — actor/target FKs in the audit table are `on delete set null`,
   so the target identity must be captured **before** purge.
3. Write an audit entry (`AuditService`) recording the outcome and the snapshot.
4. Branch on `snapshot.hasHistory`:
   - **false (pristine)** → `AdminRepository.purgeUser(userId)` then
     `auth.deleteAuthUser(userId)` → outcome `deleted`.
   - **true** → `AdminRepository.anonymizeUser(userId)` then `auth.banAuthUser(userId)`
     → outcome `anonymized`.

### Hard-delete is impossible for users with history (DB-enforced)

Discovered during implementation: `public.prevent_update_delete()` is attached
`before update or delete` on `orders`, `order_items`, `order_status_history`,
`settlement_lines`, `payment_events`, `audit_logs`, and `inventory_adjustments`, and
unconditionally raises `<table> is append-only and cannot be updated or deleted`.

Consequences:

- The order/settlement rows cannot be deleted at all.
- Deleting a `profiles` row fires `ON DELETE SET NULL` onto `audit_logs.actor_user_id`
  and `order_status_history.actor_user_id`; that SET NULL is an `UPDATE`, which the same
  guard rejects. So a profile referenced by any audit or order-status row cannot be
  deleted either.

Therefore only a **pristine** user — no orders, and not an actor in
`order_status_history` / `audit_logs` / `inventory_adjustments` — can be hard-deleted.
Everyone with history must be anonymized. This is a deliberate financial/audit integrity
design; bypassing it needs superuser trigger-disabling and was rejected.

### `snapshot.hasHistory`

`getUserDeletionSnapshot` returns `hasHistory = true` when the user has any orders or is
an actor in `order_status_history`, `audit_logs`, or `inventory_adjustments`.

### Repository — `AdminRepository.purgeUser(userId)` (pristine only)

- One transaction. Deletes the user's *deletable* child rows (`notifications`,
  `notification_preferences`, `device_tokens`, `referrals`, `campus_memberships`,
  `vendor_users`, `rider_payout_accounts`, `riders`, `admin_memberships`), detaches
  authored `vendor_invitations`, then deletes `profiles`. A pristine user has no order
  subtree, so no append-only table is touched.

### Repository — `AdminRepository.anonymizeUser(userId)` (has history)

- One transaction. Deletes `device_tokens`; sets `vendor_users`/`riders`/
  `admin_memberships` inactive; scrubs `profiles` PII (`display_name`, `email`,
  `phone_number`, `avatar_url` → null) and sets `account_status = 'deactivated'`.
  Append-only history is left intact.

### Auth side

- Pristine → `deleteAuthUser` (`auth.admin.deleteUser`) after the profile is gone.
- History → `banAuthUser` (`auth.admin.updateUserById(..., { ban_duration: '876000h' })`)
  so login is permanently dead while the profile row remains for FK integrity.

### Response

- `200` `{ userId, outcome: 'deleted' | 'anonymized' }`.

### Safety

- super_admin only (`@RequirePermission('admin:manage')` — campus_admin lacks that
  permission — plus a service-layer `assertSuperAdmin`); self-delete blocked; audited
  with a pre-action snapshot; each repository path is one transaction.

### Verification gap

The `purgeUser` / `anonymizeUser` SQL is covered by service-level unit tests (mocked
repo) but has **not** been run against a live database in this change. Before shipping,
run an integration test on a real schema: seed a user with orders, delete → assert
`anonymized` (PII gone, roles inactive, history intact, login banned); seed a pristine
user, delete → assert `deleted` (profile + auth user gone).

---

## Fix 4 — campus_admin login "Invalid login credentials" diagnosis + hardening

### Problem

A user created in Supabase Auth and auto-confirmed, then granted `campus_admin`
(app_metadata edited via copied UUID), fails `POST /auth/admin/login` with
`code: auth_failed`, message "Invalid login credentials", despite correct credentials.

### Root-cause analysis

The message is the **raw Supabase error** surfaced at `signIn` when
`signInWithPassword` fails, thrown before the role gate. The role gate is a distinct
path with message "Invalid credentials or incorrect role." Therefore the failure is at
authentication, not authorization — the `campus_admin` grant is not the cause.

Candidate causes, in order of suspicion:

1. **Environment/project mismatch** — the running API's `SUPABASE_URL` / anon key point
   to a different Supabase project than the one where the user was created. Login
   authenticates against the API's project, where the user does not exist → "Invalid
   login credentials". (Memory notes prod deliberately runs `sk_test_`; a URL/key
   mismatch is plausible.)
2. **Password never validly set** — user created without a password, or inserted
   directly into `auth.users` without a proper bcrypt hash, so no password verifies.
3. **Email confirmation** — an unconfirmed user yields "Email not confirmed" (different
   message), so likely excluded given auto-verify, but confirm it.
4. **Input hygiene** — trailing whitespace / case in the copied email or password.

### Work

1. **Diagnose:** confirm which Supabase project the deployed API targets
   (`SUPABASE_URL`, anon key) and verify the created user exists in that exact project
   with a set password and `email_confirmed_at` populated. Compare against the project
   used in the dashboard when the user was made.
2. **Fix root cause** once identified (align env to the correct project, or recreate the
   user with a proper password in the correct project).
3. **Code hardening (regardless of root cause):**
   - In `signIn`, keep the message non-enumerating for the customer/public portals but
     make the admin/vendor/rider portals log the underlying Supabase error server-side
     (logger) so operators can distinguish "no such user" vs "bad password" vs
     "unconfirmed" without leaking it to the client.
   - Trim/normalize email (lowercase, trim) before `signInWithPassword`, matching how
     signup stores it, to remove copy-paste whitespace/case as a failure mode.
   - Optional: a super_admin-only diagnostic endpoint (or CLI script) that, given an
     email, reports whether the user exists in the API's project, confirmation status,
     and resolved role — to make this class of issue self-serve to debug. Gated behind
     super_admin; returns no password material.

### Note

This item is partly operational (environment verification) and partly code (logging,
input normalization, optional diagnostic). The delete endpoint (Fix 3) is also what the
user wanted in order to clean up such mis-created accounts.

## Fix 5 — Admin creation instructions for the admin UI

The backend already exposes the correct flow; the admin UI must wire to it. No new
backend endpoint is required. This section documents how the UI creates an admin.

### Why two steps exist

An admin is defined by **two layers that must both be set**, and the endpoint below
sets both atomically:

1. `app_metadata.meal_direct_role` (`super_admin` | `campus_admin`) — the login role
   gate and JWT claim (`actor.role`).
2. A row in `public.admin_memberships` — what RLS (`is_super_admin` /
   `is_campus_admin`) and `PermissionsGuard` actually read.

Setting only one layer produces a broken admin. Do not edit these tables by hand from
the dashboard; always go through the endpoint.

### The endpoint the UI calls

`POST /admin/admin-memberships` (auth: caller must be a super_admin; guard
`@RequirePermission('admin:manage')`).

Body:

- Super admin (global):
  ```json
  { "userId": "<auth-user-uuid>", "role": "super_admin" }
  ```
- Campus admin (scoped to one campus):
  ```json
  { "userId": "<auth-user-uuid>", "role": "campus_admin", "campusId": "<campus-uuid>" }
  ```

The service inserts the `admin_memberships` row and calls `setUserAppMetadata` to set
`meal_direct_role` (+ `campus_id`) in one operation.

### UI flow to implement

1. **Get the user's auth UUID.** Either the person already signed up (customer) and the
   UI looks them up, or an operator created + confirmed them in Supabase Auth first.
   The UUID is the `auth.users.id`.
2. **Pick role** (super_admin, or campus_admin + a campus selector).
3. **Submit** to `POST /admin/admin-memberships` with the body above.
4. **Tell the new admin to sign out and back in.** `app_metadata` only enters the JWT
   on a fresh session, so an already-signed-in user must re-login before the admin role
   takes effect.

### Errors the UI should surface

- `403 admin:manage` → caller is not a super_admin.
- `400 campusId is required for campus admin memberships.` → campus not chosen.
- Unique-index conflict (existing active super_admin / campus_admin for that user) →
  the user is already that admin.

### First-ever super_admin (bootstrap, operator note)

The endpoint needs an existing super_admin, so the **first** super_admin on a fresh
project cannot be made through the UI. An operator provisions it once with the service
role: set the user's `app_metadata.meal_direct_role='super_admin'` (via Supabase admin
API) **and** insert the matching `admin_memberships` row. After that first admin exists,
all further admins are created through the UI endpoint above.

## Testing

- **Fix 1:** unit tests on `signIn`: (a) base-role vendor still works; (b) admin/
  customer with active `vendor_users` row logs into vendor portal and gets
  `role: 'vendor'` + `vendorId`; (c) inactive/no membership → forbidden with the new
  message; (d) rider/admin logins unaffected.
- **Fix 2:** unit tests that reset/resend call `authRedirectUrl(portal)` for each
  portal and default to customer when omitted; enumeration-safety preserved.
- **Fix 3:** integration/repository test against the DB: seed a user with orders +
  memberships, delete, assert all dependent rows and the profile are gone and the auth
  delete is invoked; seed a clean user and assert deletion; assert self-delete and
  non-super_admin are rejected; assert an audit row is written with the snapshot.

- **Fix 4:** unit test that email is trimmed/lowercased before `signInWithPassword`;
  test that a failed sign-in logs the underlying Supabase error server-side while the
  client response stays generic. Environment verification is manual/operational.

## Out of scope

- Multi-role model (a single user holding multiple portal roles simultaneously beyond
  the vendor-membership case).
- Front-end changes (admin dashboard delete button, portal-aware reset forms) — this
  spec is backend only.
- Rewriting FK `on delete` semantics globally; deletion is done via explicit ordered
  purge, not schema-level cascade.
