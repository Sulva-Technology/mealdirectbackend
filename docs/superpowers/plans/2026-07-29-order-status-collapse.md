# Order Status Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the order lifecycle so the vendor's only action is `paid → ready` and the customer sees four states (`paid`, `ready`, `out_for_delivery`, `delivered`), removing the `accepted`, `preparing` and `confirmed` states from the operational flow.

**Architecture:** Soft-drop — the `order_status` enum keeps all values in Postgres (the three become unreachable), but `transition_order_status` is rewired to `paid → ready` with `delivered` terminal, in-flight rows are migrated off the dead values, and the app enum / DTOs / endpoints / review gating drop the three. No customer-facing runtime mapper is needed because the collapse is real at the data layer. Physical enum recreation (hard-drop) is an optional follow-on, out of scope here.

**Tech Stack:** NestJS + Vitest (`pnpm test`), Supabase Postgres migrations + pgTAP (`pnpm db:ci` / `supabase test db` — run on a Docker host; Docker being installed now).

**Migration prefix:** `20260729######`, ordering after slice-B `20260728######`.

**Spec:** [docs/superpowers/specs/2026-07-29-order-status-collapse-design.md](../specs/2026-07-29-order-status-collapse-design.md)

**Constraint:** SQL migrations + pgTAP are static-reviewed here; `pnpm db:ci` and `database.types.ts` regen run once Docker is up (standing pre-merge gate). Nest tasks run `pnpm test` normally.

---

## New transition matrix (used by Tasks 1 and 6 — keep identical)

| From                         | To                                       |
| ---------------------------- | ---------------------------------------- |
| `pending_payment`            | `paid`, `expired`, `cancelled`           |
| `paid`                       | `ready`, `cancelled`, `refunded`         |
| `ready`                      | `out_for_delivery`, `cancelled`          |
| `out_for_delivery`           | `delivered`, `cancelled`                 |
| `delivered`                  | `administratively_completed`, `refunded` |
| `administratively_completed` | `refunded`                               |

---

### Task 1: Collapse the domain status mirror

**Files:**

- Modify: `src/domain/order-status.ts`
- Test: `test/unit/order-status.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { orderStatuses, canTransitionOrderStatus } from '../../src/domain/order-status.js';

describe('order-status collapse', () => {
  it('drops accepted, preparing, confirmed from the enum', () => {
    expect(orderStatuses).not.toContain('accepted');
    expect(orderStatuses).not.toContain('preparing');
    expect(orderStatuses).not.toContain('confirmed');
  });

  it('allows the collapsed vendor path paid -> ready', () => {
    expect(canTransitionOrderStatus('paid', 'ready')).toBe(true);
  });

  it('rejects the removed transitions', () => {
    expect(canTransitionOrderStatus('paid', 'accepted' as never)).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'confirmed' as never)).toBe(false);
  });

  it('makes delivered terminal apart from admin/refund', () => {
    expect(canTransitionOrderStatus('delivered', 'administratively_completed')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'refunded')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test order-status`
Expected: FAIL (enum still contains the three values).

- [ ] **Step 3: Implement**

Replace the `orderStatuses` array and `allowedTransitions` map in `src/domain/order-status.ts`:

```ts
export const orderStatuses = [
  'pending_payment',
  'paid',
  'ready',
  'out_for_delivery',
  'delivered',
  'administratively_completed',
  'cancelled',
  'expired',
  'refunded'
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: ['ready', 'cancelled', 'refunded'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['administratively_completed', 'refunded'],
  administratively_completed: ['refunded'],
  cancelled: [],
  expired: [],
  refunded: []
};
```

Leave `canTransitionOrderStatus` / `assertAllowedOrderStatusTransition` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test order-status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/order-status.ts test/unit/order-status.spec.ts
git commit -m "feat(status): collapse domain order-status mirror to four live states"
```

---

### Task 2: Narrow the OrderStatus type unions and status enums in DTOs

**Files:**

- Modify: `src/modules/orders/orders.types.ts:3-15` (`OrderStatus` union)
- Modify: `src/modules/orders/dto/order-api.dto.ts` (status enum ~lines 5-16; `confirmedAt` field ~line 232)
- Modify: `src/modules/admin/dto/admin.dto.ts` (status enum ~lines 18-28)

- [ ] **Step 1: Update the `OrderStatus` union in `orders.types.ts`**

Remove `'accepted'`, `'administratively_completed'` stays, remove `'confirmed'`, `'preparing'`. Result:

```ts
export type OrderStatus =
  | 'administratively_completed'
  | 'cancelled'
  | 'delivered'
  | 'expired'
  | 'out_for_delivery'
  | 'paid'
  | 'pending_payment'
  | 'ready'
  | 'refunded';
```

- [ ] **Step 2: Update the OpenAPI status enum array in `order-api.dto.ts`**

In the status enum array (currently lines ~5-16), delete the `'accepted'`, `'preparing'`, `'confirmed'` entries so it matches the union above. Remove the `confirmedAt!: string | null;` property (line ~232) and any `@ApiProperty` decorator attached to it.

- [ ] **Step 3: Update the admin status-filter enum in `admin.dto.ts`**

In the status enum array (lines ~18-28), delete `'accepted'`, `'preparing'`, `'confirmed'`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (any remaining references to the removed statuses will surface here — fix them per later tasks; if a reference appears outside Tasks 3-5 scope, note it).

- [ ] **Step 5: Commit**

```bash
git add src/modules/orders/orders.types.ts src/modules/orders/dto/order-api.dto.ts src/modules/admin/dto/admin.dto.ts
git commit -m "feat(status): drop accepted/preparing/confirmed from status types and DTO enums"
```

---

### Task 3: Remove vendor accept/prepare endpoints; keep ready

**Files:**

- Modify: `src/modules/vendors/vendor-orders.controller.ts` (remove `accept`, `prepare`, `preparing` handlers, lines ~70-116)
- Modify: `src/modules/vendors/vendor-orders.service.ts` (remove `acceptOrder`, `prepareOrder`, lines ~58-64)
- Test: `test/unit/vendor-orders.service.spec.ts` (remove accept/prepare cases, lines ~118-131)

- [ ] **Step 1: Update the failing test**

In `test/unit/vendor-orders.service.spec.ts`, delete the test cases asserting `transitionOrderStatus` called with `'accepted'` and `'preparing'` (~lines 118-131) and the `mockResolvedValue('accepted')` fixture (~line 74) — set it to `'ready'`. Add a case:

```ts
it('marks an order ready via the single vendor transition', async () => {
  await service.readyOrder(actor, orderId);
  expect(repository.transitionOrderStatus).toHaveBeenCalledWith(orderId, 'ready', userId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test vendor-orders.service`
Expected: FAIL (removed cases reference deleted methods / old expectations).

- [ ] **Step 3: Implement**

In `vendor-orders.service.ts` delete `acceptOrder` and `prepareOrder`; keep `readyOrder`. In `vendor-orders.controller.ts` delete the `@Post(':orderId/accept')`, `@Post(':orderId/prepare')` and `@Post(':orderId/preparing')` handlers; keep `@Post(':orderId/ready')`.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test vendor-orders.service && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/vendors/vendor-orders.controller.ts src/modules/vendors/vendor-orders.service.ts test/unit/vendor-orders.service.spec.ts
git commit -m "feat(status): vendor marks ready directly, remove accept/prepare endpoints"
```

---

### Task 4: Remove the customer confirm-delivery action

**Files:**

- Modify: `src/modules/orders/orders.controller.ts` (remove `confirmDelivery` handler, lines ~131-142; drop `DeliveryConfirmationEnvelopeDto` import)
- Modify: `src/modules/orders/orders.service.ts` (remove `confirmDelivery`, lines ~197-203)
- Modify: `src/modules/orders/orders.repository.ts` (remove `confirmDelivery` method + its RPC call)
- Modify: `src/modules/orders/orders.types.ts` (remove `confirmDelivery` from `OrdersRepositoryContract`, line ~199)
- Modify: `src/modules/orders/dto/order-api.dto.ts` (remove `DeliveryConfirmationEnvelopeDto`)
- Test: any spec referencing `confirmDelivery` (search first)

- [ ] **Step 1: Find references**

Run: `grep -rn "confirmDelivery\|DeliveryConfirmation\|confirm-delivery" src test`
Expected: enumerate every reference so none is missed.

- [ ] **Step 2: Update/failing test**

Remove or update specs asserting `confirmDelivery`. If a controller e2e/spec exercises `POST /orders/:id/confirm-delivery`, delete that case.

- [ ] **Step 3: Implement**

Delete the `confirmDelivery` handler in `orders.controller.ts`, the `confirmDelivery` method in `orders.service.ts`, the `confirmDelivery` method in `orders.repository.ts`, the `confirmDelivery` entry in `OrdersRepositoryContract`, and `DeliveryConfirmationEnvelopeDto` (definition + imports).

- [ ] **Step 4: Run test + typecheck + openapi**

Run: `pnpm test && pnpm typecheck && pnpm openapi:check`
Expected: PASS. (`openapi:check` confirms the removed endpoint/DTO are gone cleanly.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/orders test/
git commit -m "feat(status): remove customer confirm-delivery; delivered is terminal"
```

---

### Task 5: Re-gate reviews on `delivered`

**Files:**

- Modify: `src/modules/reviews/reviews.service.ts:22` (`reviewableStatuses`)
- Test: `test/unit/reviews.service.spec.ts` (or wherever reviews eligibility is tested)

- [ ] **Step 1: Update the failing test**

Assert a `delivered` order is reviewable and a `paid` order is not:

```ts
it('allows reviewing a delivered order', () => {
  // arrange eligibility.orderStatus = 'delivered' -> expect no throw
});
it('rejects reviewing an order that is not delivered/administratively_completed', () => {
  // arrange 'out_for_delivery' -> expect the not-reviewable error
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test reviews.service`
Expected: FAIL (currently gates on `confirmed`).

- [ ] **Step 3: Implement**

```ts
const reviewableStatuses = new Set(['administratively_completed', 'delivered']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test reviews.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reviews/reviews.service.ts test/
git commit -m "feat(status): reviews become eligible at delivered instead of confirmed"
```

---

### Task 6: Migration — rewrite `transition_order_status` and drop the confirm RPC

**Files:**

- Create: `supabase/migrations/20260729000100_collapse_order_status_transitions.sql`

- [ ] **Step 1: Write the migration**

Copy the **current 7-arg body verbatim** from `supabase/migrations/20260728000300_ready_at_and_pickup_confirm.sql` (lines 17-103) into this new migration inside `begin;`/`commit;`. Make **only** these edits:

1. Replace the transition-matrix `if not (...)` block with:

```sql
  if not (
    (v_from_status = 'pending_payment' and p_to_status in ('paid', 'expired', 'cancelled')) or
    (v_from_status = 'paid' and p_to_status in ('ready', 'cancelled', 'refunded')) or
    (v_from_status = 'ready' and p_to_status in ('out_for_delivery', 'cancelled')) or
    (v_from_status = 'out_for_delivery' and p_to_status in ('delivered', 'cancelled')) or
    (v_from_status = 'delivered' and p_to_status in ('administratively_completed', 'refunded')) or
    (v_from_status = 'administratively_completed' and p_to_status = 'refunded')
  ) then
    raise exception 'invalid order status transition from % to %', v_from_status, p_to_status using errcode = '23514';
  end if;
```

2. In the `update public.orders set ...` block, drop the `accepted_at` CASE line and change the `confirmed_at` line so it only stamps on `administratively_completed`:

```sql
      confirmed_at = case when p_to_status = 'administratively_completed' then now() else confirmed_at end,
```

Keep `ready_at`, `rider_confirmed_ready`, `delivered_at`, `cancelled_at`, `cancellation_reason`, the history insert, the outbox insert, the `p_food_was_ready` param, and the `comment on function` line unchanged.

3. After the function, drop the customer confirm RPC:

```sql
drop function if exists public.confirm_order_delivery(uuid, uuid);
```

(Confirm the exact signature first with `grep -n "confirm_order_delivery" supabase/migrations/20260612000400_orders_payments_batches_settlements.sql` and match it.)

- [ ] **Step 2: Static review**

Re-read the new file top-to-bottom; confirm only the matrix + two CASE lines + the drop differ from the source body, and `begin;`/`commit;` wrap it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729000100_collapse_order_status_transitions.sql
git commit -m "feat(status): rewire transition_order_status to paid->ready, delivered terminal"
```

---

### Task 7: Migration — migrate in-flight rows and re-gate reviews in the DB

**Files:**

- Create: `supabase/migrations/20260729000200_collapse_order_status_data_and_reviews.sql`

- [ ] **Step 1: Confirm the DB review gates**

Run: `grep -n "confirmed" supabase/migrations/20260612000400_orders_payments_batches_settlements.sql supabase/migrations/20260612000500_rls_privileges_security.sql`
Identify the review-eligibility check (`20260612000400` ~line 1423) and the review RLS policy (`20260612000500` ~line 533), both gating `in ('confirmed', 'administratively_completed')`.

- [ ] **Step 2: Write the migration**

```sql
begin;

-- Move any live order off the now-unreachable states so no row is stranded and the customer
-- boundary never observes them. delivered_at is already set on confirmed rows.
update public.orders set order_status = 'paid'
  where order_status in ('accepted', 'preparing');
update public.orders set order_status = 'delivered'
  where order_status = 'confirmed';

-- Re-gate reviews on delivered (was confirmed). Re-create the affected function and policy
-- with their current bodies, changing only the status set. Copy each body verbatim from its
-- source migration and swap 'confirmed' -> 'delivered' in the eligibility set.
--   * review-eligibility function: 20260612000400 ~line 1423
--   * review insert RLS policy:    20260612000500 ~line 533
-- (Paste the full current definitions here with the single-word change.)

commit;
```

Replace the comment block with the actual re-created function + policy definitions (read the current bodies, paste verbatim, change `'confirmed'` → `'delivered'` in the eligibility set only). Do not alter settlement IN-lists — `delivered` already covers payouts and migrated rows are now `delivered`.

- [ ] **Step 3: Static review**

Confirm the two `update` statements, the re-created function/policy differ from source only by the status swap, and `begin;`/`commit;` wrap it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729000200_collapse_order_status_data_and_reviews.sql
git commit -m "feat(status): migrate in-flight rows and re-gate reviews on delivered"
```

---

### Task 8: Update pgTAP fixtures and add collapse coverage

**Files:**

- Modify: `supabase/tests/database/102_ready_at_pickup_confirm_test.sql` (fixture at `'preparing'` → `'paid'`)
- Modify: `supabase/tests/database/105_settlement_resolved_shares_test.sql` (fixture at `'accepted'` → `'paid'`)
- Create: `supabase/tests/database/106_order_status_collapse_test.sql`

- [ ] **Step 1: Fix existing fixtures**

In `102_...` change the fixture insert `order_status` from `'preparing'` to `'paid'` and adjust the transition under test from `preparing -> ready` to `paid -> ready` (the `ready_at`/pickup assertions are unchanged). In `105_...` change the fixture insert from `'accepted'` to `'paid'`.

- [ ] **Step 2: Write the new collapse test**

```sql
begin;
select plan(5);

-- paid -> ready is legal (single vendor transition)
select lives_ok($$ select public.transition_order_status('<paid_order_uuid>', 'ready') $$,
  'paid -> ready allowed');

-- paid -> accepted is now rejected
select throws_ok($$ select public.transition_order_status('<paid_order_uuid_2>', 'accepted') $$,
  '23514', null, 'paid -> accepted rejected');

-- delivered is terminal for the happy path: delivered -> confirmed rejected
select throws_ok($$ select public.transition_order_status('<delivered_order_uuid>', 'confirmed') $$,
  '23514', null, 'delivered -> confirmed rejected');

-- delivered -> administratively_completed allowed
select lives_ok($$ select public.transition_order_status('<delivered_order_uuid_2>', 'administratively_completed') $$,
  'delivered -> administratively_completed allowed');

-- a delivered order is review-eligible (call the review-eligibility function or insert path)
-- assert the eligibility function returns true for a delivered order

select * from finish();
rollback;
```

Fill the `<...>` placeholders with fixtures inserted at the top of the file (follow the fixture style already used in `102_`/`105_`).

- [ ] **Step 3: Static review**

Confirm plan count matches the number of assertions and every fixture UUID is inserted.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/database/102_ready_at_pickup_confirm_test.sql supabase/tests/database/105_settlement_resolved_shares_test.sql supabase/tests/database/106_order_status_collapse_test.sql
git commit -m "test(status): pgTAP for the collapsed transition matrix and review gate"
```

---

### Task 9: Update seed data

**Files:**

- Modify: `supabase/seed.sql` (`MD-SEED-PREPARING` line ~288; `MD-SEED-CONFIRMED` line ~290)

- [ ] **Step 1: Edit seeds**

Change the `MD-SEED-PREPARING` order's `order_status` from `'preparing'` to `'paid'` (rename to `MD-SEED-PAID-2` if the label matters, else leave the label). Change `MD-SEED-CONFIRMED`'s `order_status` from `'confirmed'` to `'delivered'`. Leave the `delivery_assignments … 'accepted'` row (line ~348) — that is the assignment enum, not order_status.

- [ ] **Step 2: Static review**

Run: `grep -n "'accepted'\|'preparing'\|'confirmed'" supabase/seed.sql`
Expected: only the `delivery_assignments` `'accepted'` row remains.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "test(status): reseed orders onto collapsed statuses"
```

---

### Task 10: Full verification + Docker gate

- [ ] **Step 1: Nest suite**

Run: `pnpm test && pnpm typecheck && pnpm openapi:check`
Expected: all green; test count roughly matches slice B+C baseline minus removed cases.

- [ ] **Step 2: Regenerate OpenAPI if drift**

If `pnpm openapi:check` reports drift, run the project's regenerate command (as used in slice B+C, commit `d6d95b2`) and commit the regenerated spec.

- [ ] **Step 3: Docker DB gate (once Docker is up)**

Run: `pnpm db:ci` (and `supabase test db`) on this machine now that Docker is installed. Fix any SQL error surfaced (the whole point of installing Docker). Then regenerate `supabase/types/database.types.ts`.

- [ ] **Step 4: Commit any regen**

```bash
git add supabase/types/database.types.ts openapi*.json
git commit -m "chore(status): regen db types and OpenAPI for the collapsed status model"
```

- [ ] **Step 5: Update memory + roadmap**

Note slice D built in the roadmap (`docs/superpowers/specs/2026-07-25-v2-roadmap.md`) and write/update the slice-D memory file.

---

## Self-review notes

- **Spec coverage:** matrix rewrite (T1/T6), type/DTO narrowing (T2), vendor one-tap (T3), confirm removal (T4), review re-gate (T5 app + T7 DB), data migration (T7), tests (T8), seed (T9), verification incl. Docker gate (T10). All spec sections mapped.
- **Deferred to a follow-on (not this plan):** physical enum recreation (hard-drop) — pending Docker verification + explicit go-ahead.
- **Type consistency:** `OrderStatus` union (T2) matches `orderStatuses` (T1) and the DB matrix (T6). `reviewableStatuses` (T5) matches the DB review gate (T7).
