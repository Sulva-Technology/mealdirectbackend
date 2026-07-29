# Slice D — Order status collapse

**Date:** 2026-07-29
**Branch:** continues `feat/v2-wallet-dedicated-account` (single v2 cutover, one migration set)
**Status:** Design agreed in brainstorm; awaiting review. Building the soft-drop foundation in
parallel while Docker is installed (see §Verification).
**Depends on:** slice B+C ([2026-07-28-fee-model-timing-design.md](2026-07-28-fee-model-timing-design.md)),
whose timing logic keys on `ready` / `out_for_delivery` / `delivered` — all retained here.

## Goal

Reduce the order lifecycle to the four customer-visible states **`paid`, `ready`,
`out_for_delivery`, `delivered`** (plus the pre-payment and terminal states), and — the operational
driver — **cut the vendor from three taps per order (accept → prepare → ready) to one (ready)**
across a busy service day. This is a *real* collapse of the state machine, not a display relabel:
the intermediate states stop existing operationally, not just visually.

## Decision: Option B (real collapse), not a display mapping

Brainstorm considered two options:

- **Option A — display mapping only.** Keep the 12-status machine; map to 4 states at the customer
  read boundary. *Rejected:* it does nothing for the real pain — the vendor still taps three times
  per order. The point of this slice is to remove vendor work, which a display layer cannot do.
- **Option B — real collapse (chosen).** The vendor's path becomes `paid → ready` directly;
  `accepted`, `preparing` and `confirmed` are removed from the operational flow.

### Confirmed sub-decisions

1. **Vendor pre-ready step: none.** `paid → ready` in one action. There is no `accept`/`preparing`
   step. Rejecting an order remains `paid → cancelled` (refund). The "new orders" worklist is simply
   *paid and not-yet-ready*. (Chosen over keeping a single `accept` acknowledgment.)
2. **Customer confirm-receipt removed.** `delivered` becomes the terminal happy-path state. The
   `confirmed` status and the customer `POST /orders/:orderId/confirm-delivery` action are removed.
   **⚠ Flagged for sign-off** — this is a customer-facing behavior removal. It is safe because:
   - Settlements already fire on `delivered` (`produce_rider_daily_settlement` /
     `produce_vendor_daily_settlement` gate on `in ('delivered','confirmed','administratively_completed')`),
     so **no payout depends on `confirmed`**.
   - `confirmed` today gates only **reviews** (`reviewableStatuses = {confirmed,
     administratively_completed}`). Re-gate reviews on `delivered` and the review flow is preserved,
     just available one step earlier.

## Collapse strategy: soft-drop foundation, hard-drop optional

Postgres cannot `DROP` a value from an enum type — removing `accepted`/`preparing`/`confirmed` from
`public.order_status` requires recreating the type and rewriting every function, constraint, index
and default that references it. That is the single most invasive migration in v2.

**This slice builds the soft-drop foundation**, which delivers the entire user-visible and
operational outcome:

- The `order_status` enum **keeps** all twelve values in the DB (the three are harmless and become
  unreachable — nothing can transition *into* them, and no live row holds them after the data
  migration).
- `transition_order_status` is rewired so `paid → ready` is the only vendor path and `delivered` is
  terminal.
- Any in-flight rows are migrated off the dead values (`accepted`/`preparing → paid`,
  `confirmed → delivered`), so no live order sits in an unreachable state and the customer boundary
  never observes one.
- The app enum, DTOs, review gating, vendor/customer endpoints and tests drop the three.

**Soft-drop is a strict subset of hard-drop.** If, after Docker verification, we want the enum
physically cleaned, it is one additional appended migration (recreate `order_status` without the
three values, re-cast the column and every dependent object) layered on top — nothing in the
soft-drop foundation is wasted or reworked. Recommendation: ship soft-drop; treat the physical
recreation as an optional follow-on, greenlit only if the tidier catalog is judged worth the
migration risk (the dead values are invisible to every consumer either way).

## The collapsed state machine

```
pending_payment ─▶ paid ─▶ ready ─▶ out_for_delivery ─▶ delivered   (terminal, happy path)
       │            │        │              │
       ▼            ▼        ▼              ▼
  expired /     cancelled  cancelled    cancelled
  cancelled     / refunded
                                        delivered ─▶ administratively_completed / refunded (admin/ops)
```

New transition matrix (replaces the current one in `transition_order_status` and its app mirror):

| From | To |
|---|---|
| `pending_payment` | `paid`, `expired`, `cancelled` |
| `paid` | `ready`, `cancelled`, `refunded` |
| `ready` | `out_for_delivery`, `cancelled` |
| `out_for_delivery` | `delivered`, `cancelled` |
| `delivered` | `administratively_completed`, `refunded` |
| `administratively_completed` | `refunded` |

Removed rows: `paid → accepted`, `accepted → preparing`, `preparing → ready`,
`delivered → confirmed`, `confirmed → refunded`.

The `p_food_was_ready boolean` 7-arg signature from B+C is preserved unchanged; `ready_at` stamping
on `-> ready` and `rider_confirmed_ready` on `-> out_for_delivery` are unchanged. `accepted_at`
stamping is dropped (no `accepted` state); `confirmed_at` is now stamped only on
`administratively_completed`.

## Touch-point inventory

### Database (new migrations, prefix `20260729######`, after slice-B `20260728######`)

1. **Rewrite `transition_order_status`** with the new matrix (copy the current 7-arg body verbatim
   from `20260728000300_ready_at_and_pickup_confirm.sql`, change only the matrix + the
   `accepted_at`/`confirmed_at` CASE arms). Keep the 7-arg signature and comment.
2. **Data migration for in-flight rows:** `update orders set order_status='paid'` where status in
   (`accepted`,`preparing`); `='delivered'` where status = `confirmed` (preserving `delivered_at`,
   already set on those rows). Run **before** any function that would reject the dead states.
3. **Remove the customer confirm path:** drop `confirm_order_delivery` (the RPC at
   `20260612000400` line ~1366 that calls `transition_order_status(...,'confirmed',...)`), or reduce
   it to a no-op removal. Remove the Nest endpoint + service + repository method.
4. **Re-gate reviews on `delivered`:** the review-insert RLS/eligibility check
   (`20260612000500` line ~533 and the eligibility function at `20260612000400` ~line 1423) changes
   `in ('confirmed','administratively_completed')` → `in ('delivered','administratively_completed')`.
5. **Settlement IN-lists:** already include `delivered`; leaving `'confirmed'` in the list is
   harmless (no new rows reach it, migrated rows became `delivered`). **No change required** for
   soft-drop; the hard-drop follow-on would prune them.
6. **Notification labels** (`emit_order_lifecycle_events` CASE for `order.accepted` /
   `order.preparing` / `order.confirmed`): those events no longer fire; the arms are dead but
   harmless. Confirm `order.ready` already has a customer-facing label (it does). Optional cleanup.

### Application (Nest / TS)

- `src/domain/order-status.ts` — remove `accepted`/`preparing`/`confirmed` from `orderStatuses` and
  the `allowedTransitions` map (new matrix above). This mirror stays in lockstep with the DB.
- `src/modules/orders/orders.types.ts` — drop the three from the `OrderStatus` union.
- `src/modules/orders/dto/order-api.dto.ts` — drop the three from the OpenAPI status enum; remove
  the `confirmedAt` field from the customer DTO (always null post-collapse) — or retain the column
  and simply stop documenting it. Prefer dropping from the DTO.
- `src/modules/orders/orders.controller.ts` / `orders.service.ts` / `orders.repository.ts` — remove
  `confirmDelivery` (endpoint, service method, repository method, `DeliveryConfirmationEnvelopeDto`).
- `src/modules/vendors/vendor-orders.controller.ts` — remove `POST :orderId/accept`,
  `:orderId/prepare`, `:orderId/preparing`; keep `:orderId/ready`.
- `src/modules/vendors/vendor-orders.service.ts` — remove `acceptOrder`, `prepareOrder`; keep
  `readyOrder`.
- `src/modules/reviews/reviews.service.ts` — `reviewableStatuses = {delivered,
  administratively_completed}`.
- `src/modules/admin/dto/admin.dto.ts` — drop the three from the admin status-filter enum.
- **No customer-facing runtime mapper is needed.** Because the collapse is real at the data layer
  (dead states unreachable + in-flight rows migrated), customer reads already return only
  `paid`/`ready`/`out_for_delivery`/`delivered` + `pending_payment` + terminals. `pending_payment`
  stays as-is (genuine pre-payment state, surfaced via payment-status polling).

### Tests

- `test/unit/vendor-orders.service.spec.ts` — remove accept/prepare cases; keep ready.
- Reviews specs — update eligibility to `delivered`.
- `src/domain` order-status unit tests — new matrix.
- `supabase/seed.sql` — `MD-SEED-PREPARING` → seed at `paid` (or drop); `MD-SEED-CONFIRMED` →
  `delivered`. (The `delivery_assignments … 'accepted'` row is the *assignment* enum — leave it.)
- **pgTAP:** `102_ready_at_pickup_confirm_test.sql` inserts a fixture at `'preparing'` to test
  `preparing → ready` — change to insert at `'paid'` and test `paid → ready`.
  `105_settlement_resolved_shares_test.sql` inserts at `'accepted'` — change to `'paid'`.
- **New pgTAP** for the collapse: `paid → ready` legal; `paid → accepted` now rejected;
  `delivered` terminal (`delivered → confirmed` rejected); reviews eligible at `delivered`;
  in-flight data migration maps the dead states.

## Out of scope

- Physical enum recreation (hard-drop) — optional follow-on migration, §Collapse strategy.
- Eating-habit analytics (slice F) — consumes the `delivered` signal this slice finalizes.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm openapi:check` green (Nest tasks run here).
- Migrations + pgTAP **static-reviewed**, then `pnpm db:ci` / `supabase test db` + `database.types.ts`
  regen **on this machine once Docker is up** (being installed now — this lifts the standing
  no-Docker pre-merge gate for slice D, and also for the already-built A and B+C).

## Open items for review

1. **Confirm removal of the customer confirm-delivery step** (§Confirmed sub-decisions 2). If you
   want to keep a non-blocking "mark received" acknowledgment, say so and it stays as a flag that
   does not change `order_status`.
2. **Soft-drop now, hard-drop later?** Default is soft-drop only this slice. Say the word to append
   the physical enum-recreation migration once Docker verifies it.
