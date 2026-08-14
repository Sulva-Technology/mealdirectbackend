# Multi-Role Accounts — Design

**Date:** 2026-08-14
**Status:** Approved, ready for planning

## Problem

One Meal Direct account can hold exactly one live role. `app_metadata.meal_direct_role` is a
single mutable string; Supabase mints the JWT role claim from it, and every portal login and
every grant rewrites it. Three user-visible failures follow:

1. **A role cannot be added to an existing account.** `POST /rider/onboard` is guarded
   `@RequireRoles('rider')` (`src/modules/riders/riders.controller.ts:84`) — you must already be a
   rider to become one. `resolveGrantForLogin` only recovers `rider` from
   `user_metadata.meal_direct_role`, which is written once at signup
   (`src/modules/auth/supabase-auth.service.ts:541`). A customer therefore has no path to rider.
   The same class-level gate blocks `POST /vendor/onboard`.
2. **A grant erases the previous role.** Granting admin overwrites the single role string.
   Patches exist for specific pairs (self-service base role, universal customer fallback) but each
   new combination needs another special case, and combinations without one strand the user.
3. **Signup rejects an existing email.** The only way to hold a second role is a second email
   address, which is what users actually do today.

A fourth failure is latent and becomes visible as soon as (1) is fixed: two portals open at once
(rider app plus customer app) fight over the same claim, so refreshing one session breaks the
other.

Root cause for all four: **role is a single assigned value rather than a derived set.**

## Design

### 1. Role model — the database is the source of truth, the JWT is a cache

An account's roles are derived, never assigned:

| Role | Source of truth |
| --- | --- |
| `customer` | every account, unconditionally |
| `rider` | a `public.riders` row for the `user_id` (pending vs. verified remains a separate state) |
| `vendor` | a `vendor_users` grant |
| `campus_admin` / `super_admin` | an active `admin_memberships` row |

On sign-in, on session-refresh-after-metadata-sync, and after any grant mutation, the backend
recomputes the **entire** set and writes it to `app_metadata`:

```json
{
  "meal_direct_roles": ["customer", "rider"],
  "meal_direct_role": "rider",
  "campus_id": "...",
  "vendor_id": "...",
  "rider_id": "..."
}
```

- `meal_direct_roles` is the new authoritative claim.
- `meal_direct_role` continues to be written — it carries the primary role (highest-privilege held
  role) so live sessions and unmodified frontends keep working.
- Scope claims (`campus_id`, `vendor_id`, `rider_id`) are unchanged; they are per-role identifiers
  with distinct keys and do not collide.

Because the set is recomputed wholesale from grant tables, a grant can no longer erase anything.
The existing special-case ladder in `resolveGrantForLogin` (self-service base role, universal
customer fallback, per-portal branches) collapses into one derivation function.

**No backfill migration.** Legacy single-role claims still resolve, and the first login after
deploy writes the full set. `user_metadata.meal_direct_role` remains readable as a transitional
signal but stops being load-bearing.

### 2. Guards — any held role satisfies the route

`AuthenticatedActor` gains `roles: ActorRole[]`. The existing `role` field stays and now means
*the effective role for this request*.

- `SupabaseJwtService.toActor` reads `meal_direct_roles` when present, else falls back to the
  single `meal_direct_role` (wrapped in a one-element array), else `['customer']`.
- `RolesGuard` passes when **any** held role appears in `@RequireRoles(...)`, and sets
  `actor.role` to the matched role. When several match, the order declared on the route decides.
  All 32 existing route guards keep their current declarations.
- `PermissionsGuard` and the `admin_memberships`-driven granular RBAC are untouched. Entry to
  admin controllers still requires a held admin role; permission checks still refine which actions
  are allowed.
- Shared routes that carry no `@RequireRoles` (`/orders/:id`, chat, notifications, wallets,
  campuses, catalog) do not select a lens. The domain helpers in `src/domain/authorization.ts`
  evaluate access as a union over held roles: an order is readable if the caller is its customer,
  **or** its assigned rider, **or** a campus admin for its campus. This is the correct semantics
  for "may this human see this record", and it is what stops a rider-and-customer account from
  losing access to its own orders.

`AuthorizationContext` therefore gains `roles` alongside `role`; `canReadOrder`,
`canManageAdmin`, and `canAccessVendorSettlement` iterate the set. Callers that pass a
single-role context keep working because the set derived from a single role is a one-element set.

Consequence: two portals stay live on one login. There is no role-switch endpoint and no
active-role concept on the server.

### 3. Acquiring a role through the signup form

`POST /auth/signup` with an email that already exists no longer fails:

1. Attempt `signInWithPassword` with the supplied credentials.
2. **Wrong password** — the same generic "already registered" style error returned today. No
   information about which accounts exist, and no distinction between wrong-password and
   no-such-account.
3. **Correct password** — a session is returned and the requested role is added when it is
   self-service:
   - `customer` — immediate; every account already holds it.
   - `rider` — the response carries `onboardingRequired: true`. The portal then calls
     `POST /rider/onboard` with campus, display name, and phone, which creates the `riders` row and
     makes the role appear on the next token refresh. Admin verification before delivery access is
     unchanged.
   - `vendor` — never self-granted. Vendor access continues to flow through invitation or the
     approval-gated onboarding path.
   - `campus_admin` / `super_admin` — never self-service, under any circumstances.

To break the chicken-and-egg, `POST /rider/onboard` and `POST /vendor/onboard` move off the
class-level `@RequireRoles` gate and become reachable by any authenticated user. Every other route
on `RidersController` and `VendorsController` keeps its existing gate. `onboardRider`'s internal
`actor.role !== 'rider'` check is removed in favour of the existing already-linked conflict check;
`onboardVendor` keeps whatever approval gate it has today.

### 4. Security boundaries

- Privileged roles are only ever derived from `admin_memberships`. Nothing in the signup or
  onboarding path can produce them.
- `vendor` is only ever derived from `vendor_users`. Self-service signup cannot produce it.
- `user_metadata` is user-editable and must never be a source for the derived set. The existing
  `AUTH_ALLOW_USER_METADATA_ROLE_FALLBACK` flag keeps its current default (off) and its current
  restriction to self-service roles.
- The signup-on-existing-email path must not become an account-enumeration oracle: identical
  response shape for wrong-password and unknown-email.

### 5. Testing

**Unit**

- Role-set derivation for each grant combination: none, rider only, vendor only, admin only, and
  every mixed pair including admin+rider and admin+vendor.
- `RolesGuard` effective-role selection: single match, multiple matches (declared order wins), no
  match (403).
- `SupabaseJwtService.toActor` claim precedence: `meal_direct_roles` present, absent (legacy
  single-role token), both absent.
- Union semantics in `canReadOrder`, `canManageAdmin`, `canAccessVendorSettlement`.

**Integration**

- A customer adds rider, then a single token answers 200 on both a customer route and a rider
  route.
- An admin grant leaves customer and rider portal access intact.
- Signup on an existing email with a wrong password returns the generic error.
- Signup with `role=vendor` on an existing account does not produce a vendor grant.
- `/rider/onboard` reachable by a plain customer; `/rider/profile` still 403 for one.

The existing test suite is the regression net for single-role accounts, whose behaviour must not
change.

## Out of scope

- **Frontend role handling.** All four portals store a single `role` string. They keep working
  (the primary-role claim is still written), but until they read `roles`, a person will not see two
  portals inside one app shell. Tracked as follow-up work per portal.
- **Role-switch UI / active-role concept.** Deliberately not built; the union model makes it
  unnecessary.
- **Migrating away from `meal_direct_role`.** The claim stays indefinitely for compatibility; a
  later cleanup can drop it once every client reads `roles`.

## Open decisions deferred to the plan

- Whether the derivation function lives in `src/domain/` (pure, given grant rows) with the
  repository lookups staying in `AuthRoleGrantsRepository`. Preference: yes, so it is unit-testable
  without a database.
- Whether grant-mutating admin endpoints recompute claims synchronously or leave it to next login.
  Preference: recompute synchronously where the grant write already has the user id to hand, since
  the cost is one `setUserAppMetadata` call.
