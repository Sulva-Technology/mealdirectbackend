# Slice B (+C) — Fee model rework with timing incentives

**Date:** 2026-07-28
**Branch:** continues `feat/v2-wallet-dedicated-account` (single v2 cutover, one migration set)
**Status:** Design agreed, awaiting spec review before planning.
**Supersedes roadmap split:** the roadmap had B (fee rework) and C (timing incentive ±₦50) as
separate slices. They are **merged into one slice** here — the configurable shares are inherently
timing-conditional, so building them unconditionally in B just to rewrite them in C wastes work.
The roadmap's slice D (status collapse), E (payouts) and F (habits) are unchanged and still follow.

## Goal

Raise the customer-facing delivery fee to **₦300** (₦400 for point delivery), split it three ways
between **platform / rider / vendor** with the shares **admin-configurable** and **conditional on
punctuality**, and make **any forfeited share fall through to the platform**. Persist the resolved
split per order so settlements pay the right party.

## The money model

All amounts in kobo. Configurable values live in `platform_settings` (admin-editable, audited);
the numbers below are the seeded defaults.

### Customer-facing delivery fee

|                            | Amount        | Source                     |
| -------------------------- | ------------- | -------------------------- |
| Base delivery fee          | ₦300 (30000)  | `fee_delivery_base_kobo`   |
| Point-delivery surcharge   | +₦100 (10000) | `fee_point_surcharge_kobo` |
| **Total (standard)**       | **₦300**      |                            |
| **Total (point delivery)** | **₦400**      |                            |

`total_kobo = food_subtotal_kobo + delivery_fee_kobo - discount_kobo` is unchanged;
`delivery_fee_kobo` is now `base (+ surcharge if point)` instead of a flat 15000.

### How the fee is split

Every share is resolved **at the `delivered` transition**, when `ready_at`, `delivered_at`, the
slot target time, the point flag and the rider's "was ready" confirmation are all known.

| Party                       | On time      | Missed                                                                            | Config key                                         |
| --------------------------- | ------------ | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Rider** (delivery)        | ₦100 (10000) | ₦50 (5000) — forfeits ₦50                                                         | `share_rider_ontime_kobo`, `share_rider_late_kobo` |
| **Vendor** (cooking)        | ₦50 (5000)   | ₦0 — forfeits ₦50                                                                 | `share_vendor_ontime_kobo`                         |
| **Point surcharge → rider** | ₦50 (5000)   | ₦50 — _not_ timing-gated (paid for the extra distance on any successful delivery) | `share_point_rider_kobo`                           |
| **Platform**                | remainder    | remainder **+ all forfeits**                                                      | derived, never stored as config                    |

**Platform is the residual.** It is never a fixed number:

```
platform_share = delivery_fee_kobo - rider_share_resolved - vendor_share_resolved
```

This makes the model robust to any base change: if an operator lowers the base or a zone charges
less, rider/vendor keep their fixed amounts and platform simply absorbs the difference (floored at
0 — a base below rider+vendor is rejected at settings-update time, see Error handling).

### On-time definitions

- **Slot target time** = `service_date` + `delivery_slots.delivery_time`, interpreted in the
  campus's local timezone. This is the promised delivery moment.
- **Vendor on time** = food marked ready at least `vendor_ready_lead_minutes` (default 10) before
  the target: `ready_at <= target - lead`.
- **Rider on time** = delivered at or before the target: `delivered_at <= target`.

### Anti-gaming: vendor bonus requires corroboration

For `meal_direct_rider` orders the vendor's ₦50 releases only if **all three** hold:

1. `ready_at <= target - vendor_ready_lead_minutes` (marked ready early), **and**
2. the order actually reached `out_for_delivery` (a rider picked it up — proves food existed), **and**
3. the rider's `food_was_ready` confirmation = true.

Confirmation is folded into the step the rider already performs: the `ready -> out_for_delivery`
transition gains a `p_food_was_ready boolean` argument (defaults true). No new screen or extra tap
flow. A vendor who presses Ready with no food gets flagged false by the rider and earns no bonus.

### Vendor self-delivery (`vendor_delivery` mode)

The vendor both cooks and delivers, so **the vendor collects both the cooking and the rider
shares**, and the point-surcharge rider portion too:

- Cooking ₦50 if `ready_at <= target - lead` (timestamp only — the vendor cannot confirm their own
  food, so rule 3 does not apply here).
- Delivery ₦100 if `delivered_at <= target`, else ₦50.
- Point ₦50 if point delivery.
- Platform gets the residual + forfeits.

One consistent ₦300 economic model across both delivery modes; the only difference is who receives
the rider share and that self-delivery on-time is judged purely on timestamps.

## Point delivery

"Point delivery" means the customer wants the food brought to a specific spot — a hostel room or a
classroom — rather than a general zone drop.

- The customer opts in explicitly at checkout. The UI shows a disclosure ("this adds ₦100") before
  they confirm.
- Modeled as a new `orders.point_delivery boolean not null default false`. The existing
  `orders.room_number` free-text column is reused as the optional point **label** (its comment is
  broadened from "hostel room number" to "point-delivery label — hostel room, classroom, etc.").
- When `point_delivery` is true, `delivery_fee_kobo` includes `fee_point_surcharge_kobo` and the
  rider (or self-delivering vendor) earns `share_point_rider_kobo`.

## Data model changes

### `orders` — new / changed columns

| Column                          | Change                                   | Notes                                                                                |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `delivery_fee_kobo`             | constraint relaxed                       | was pinned `= 15000`; now `>= 0`. New orders: base (+surcharge).                     |
| `point_delivery`                | **new** `boolean not null default false` | customer choice                                                                      |
| `ready_at`                      | **new** `timestamptz`                    | set on `-> ready` transition, mirroring `delivered_at`                               |
| `rider_confirmed_ready`         | **new** `boolean`                        | captured at pickup; null until then                                                  |
| `platform_delivery_share_kobo`  | repurposed                               | now the **resolved** variable platform residual, set at `delivered`; null until then |
| `rider_delivery_share_kobo`     | **new** `integer`                        | resolved at `delivered`; null until then                                             |
| `vendor_delivery_share_kobo`    | **new** `integer`                        | resolved at `delivered` (cooking [+ self-delivery]); null until then                 |
| `delivered_on_time`             | **new** `boolean`                        | audit/analytics of the resolution                                                    |
| `ready_on_time`                 | **new** `boolean`                        | audit/analytics of the resolution                                                    |
| `fulfiller_delivery_share_kobo` | **retained**                             | kept for historical rows and the backfill mapping; no longer written by new orders   |

### Constraints to relax / replace

- `orders_money_non_negative`: drop the `= 15000 / = 7500 / = 7500` pins. Keep all existing `>= 0`
  checks (as of implementation the live constraint also carries `service_fee_kobo >= 0`, added by a
  later migration — preserve it) and add `>= 0` guards for the two new nullable share columns.
- New `orders_resolved_shares_balance`: `delivered_on_time is null OR (rider + vendor + platform =
delivery_fee_kobo)`. **Scoped by `delivered_on_time`, not by the shares being null** — the
  resolution function (below) sets `delivered_on_time` together with the balanced shares, while the
  historical backfill sets only rider/vendor and leaves `delivered_on_time` null. This exempts
  historical rows (whose pinned 7500/7500 need not sum to a per-zone `delivery_fee_kobo`) so the
  migration can never abort, while enforcing the invariant on every newly resolved order.
- `orders_total_formula`: unchanged in intent (`total = food + delivery_fee ± other fees - discount`;
  the live formula also includes `service_fee_kobo` and `large_order_surcharge_kobo` — the higher
  `delivery_fee_kobo` flows through it automatically).
- `delivery_batches_earnings_formula` (`delivery_earnings_kobo = order_count * 7500`): relax to
  `delivery_earnings_kobo >= 0`. The batch's rider earnings become the **sum of the batch's
  per-order `rider_delivery_share_kobo`**, not a flat multiple.
- `calculate_delivery_earnings(order_count)`: replaced by summing resolved rider shares; the old
  flat helper is dropped (or made to raise, callers updated).

### `platform_settings` — seeded keys

```
fee_delivery_base_kobo      30000   -- ₦300 customer delivery fee
fee_point_surcharge_kobo    10000   -- ₦100 point-delivery surcharge
share_rider_ontime_kobo     10000   -- ₦100 rider on-time delivery
share_rider_late_kobo        5000   -- ₦50 rider floor when late
share_vendor_ontime_kobo     5000   -- ₦50 vendor cooking-on-time
share_point_rider_kobo       5000   -- ₦50 of the surcharge to the fulfiller
vendor_ready_lead_minutes      10   -- minutes-before-slot threshold
```

Read through the existing `platform_setting_int(key, default)` helper so a missing/malformed row
falls back to the application default and can never silently change pricing.

## Behavioural changes

### Order creation (all paths)

Every order-creation RPC — the current customized-order function and the slice-A
`create_paid_order_from_wallet` — computes `delivery_fee_kobo = base (+ surcharge if point_delivery)`
from settings, records `point_delivery`, and leaves the resolved share columns null. `total_kobo`
picks up the higher fee automatically. Wallet balance checks and Paystack charge amounts therefore
reflect ₦300/₦400 with no extra wiring.

### `ready` transition

Sets `ready_at = now()` (like `delivered_at` is set on `delivered`).

### `ready -> out_for_delivery` transition

Gains `p_food_was_ready boolean default true`; stores it in `rider_confirmed_ready`.

### `delivered` transition — the resolution point

Computes and persists, in one place:

- `ready_on_time`, `delivered_on_time` (vs slot target in campus tz)
- `rider_delivery_share_kobo` — on-time/late + point portion, by mode
- `vendor_delivery_share_kobo` — cooking bonus (rider-confirmed for rider mode, timestamp-only for
  self-delivery) [+ self-delivery rider portion in `vendor_delivery` mode]
- `platform_delivery_share_kobo` — residual = `delivery_fee_kobo - rider - vendor`

**Financial-history trigger must be relaxed.** `protect_order_financial_history` (BEFORE UPDATE on
`orders`) currently rejects any post-payment change to `platform_delivery_share_kobo` /
`fulfiller_delivery_share_kobo`, so the resolver — which rewrites `platform_delivery_share_kobo` at
`delivered` — would be blocked. The trigger is amended to drop those two split columns from its
guarded set. The customer-paid snapshot (`food_subtotal_kobo`, `delivery_fee_kobo`, `discount_kobo`,
`total_kobo`, `currency`) and `order_number` stay immutable after payment; only the internal
delivery-fee _split_, which v2 resolves at delivery by design, becomes mutable at that transition.

### Settlements

- Rider daily settlement sums `rider_delivery_share_kobo` (was `fulfiller_delivery_share_kobo`) over
  the rider's `meal_direct_rider` orders; `rider_delivery` line uses the same resolved value.
- Vendor daily settlement's `vendor_delivery` line uses `vendor_delivery_share_kobo` for both modes
  (cooking bonus always; delivery share too when `vendor_delivery`).
- Batch `delivery_earnings_kobo` = sum of the batch's resolved rider shares.

## Historical data / backfill

Existing delivered orders keep their old economics — the migration must not rewrite their money.
One-time backfill of the new columns for already-terminal rows:

- `delivery_fee_kobo` stays 15000 (constraint now permits it — it only requires `>= 0`).
- `rider_delivery_share_kobo` = `fulfiller_delivery_share_kobo` where `delivery_mode =
'meal_direct_rider'`, else 0.
- `vendor_delivery_share_kobo` = `fulfiller_delivery_share_kobo` where `delivery_mode =
'vendor_delivery'`, else 0.
- `platform_delivery_share_kobo` keeps its stored 7500 (already the residual for old rows).
- `point_delivery` = false; `ready_at`/`ready_on_time`/`delivered_on_time`/`rider_confirmed_ready`
  = null/unknown for history.

The resolved-share sum check applies only to rows resolved under the new logic (guarded on
`delivered_on_time is not null`); historical backfilled rows leave `delivered_on_time` null and are
therefore exempt — necessary because a historical order delivered to a higher-fee zone kept its
pinned 7500/7500 shares that do not sum to that fee.

## Error handling

- **Settings update guard:** `PATCH /admin/settings` rejects a fee configuration where
  `share_rider_ontime_kobo + share_vendor_ontime_kobo > fee_delivery_base_kobo` (platform residual
  would go negative), and rejects any negative amount or a non-positive lead. Returns a 4xx with a
  clear code; the seeded defaults always pass.
- **Missing/malformed setting:** falls back to the application default via `platform_setting_int`.
- **Resolution invariants:** the `delivered` handler asserts the three resolved shares are
  non-negative and sum to `delivery_fee_kobo` before writing; a violation raises (SQLSTATE `23000`)
  rather than persisting an unbalanced order.
- **Point surcharge is order-time immutable:** once set at creation it does not change if settings
  change later; the customer pays what they were shown.

## Analytics surface (the ±₦50 story, made visible)

`ready_on_time`, `delivered_on_time`, `rider_confirmed_ready` and the resolved share columns let
admin/vendor/rider views report punctuality and its pay impact without recomputation. No new
endpoints in this slice beyond exposing these fields on existing order/settlement reads; a dedicated
incentive dashboard is out of scope (belongs with slice F).

## Testing

- **pgTAP** per migration: fee computation at creation (standard + point); `ready_at` set on ready;
  `rider_confirmed_ready` captured at pickup; the four resolution outcomes (rider on/late × vendor
  hit/miss) for `meal_direct_rider`; the two `vendor_delivery` outcomes; residual = fee − rider −
  vendor and the sum invariant; settlement lines pay the resolved amounts; batch earnings = sum of
  rider shares; historical backfill leaves old orders balanced; settings guard rejects a
  negative-residual config.
- **Unit (Nest/Vitest):** DTO validation for `point_delivery` and the pickup `food_was_ready` flag;
  settings-update guard; order-creation fee assembly reads settings and includes the surcharge.
- Full `pnpm test`, `pnpm typecheck`, `pnpm openapi:check` green; `pnpm db:ci` on a Docker host
  before merge (this machine has no Docker — same constraint as slice A).

## Rollout

Part of the single v2 cutover: migrations apply in filename order with the rest of v2, defaults
seeded into `platform_settings`, no separate runtime flag for the money model (unlike the DVA
piece). Operators tune the seven config values live afterward without a deploy.

## Out of scope (later slices)

- Order status collapse to four states (slice D).
- Vendor/rider Paystack transfer enablement (slice E) — settlements accrue the new shares now; when
  they pay out is E's concern.
- Eating-habit analytics (slice F).
