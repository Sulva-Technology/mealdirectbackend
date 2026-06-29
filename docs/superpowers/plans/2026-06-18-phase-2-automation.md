# Phase 2 — Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make day-to-day operations hands-off: zone-based delivery pricing, a server-validated promotions engine, rider availability, and automatic rider dispatch driven by the Phase 1 outbox worker.

**Architecture:** Delivery fee becomes a per-zone value the order-creation DB function reads; the TS quote reads the same source. A new `promotions` module validates and applies discount codes at quote + create. A dispatch handler registered on `order.ready` events assigns an available rider to the order's batch by zone + current load, writing a `delivery_assignment` and transitioning the order. Manual admin assignment remains the override.

**Tech Stack:** NestJS 11, Kysely + `pg`, Supabase Postgres 15, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-18-production-readiness-design.md` (Phase 2).

**Prerequisite:** Phase 1 merged (outbox worker + handler registry + event taxonomy).

---

## Background facts (verified in code)

- `campus_zones` (`migration 200:57`): `id, campus_id, name, code, active, display_order` — **no
  fee column**.
- `delivery_batches` (`migration 400:241`) is keyed by `(campus_id, vendor_id, service_date,
delivery_slot_id, zone_id, delivery_mode)`; `delivery_earnings_kobo = order_count * 7500`
  (rider earnings, hardcoded). Customer-facing fee lives in `orders.delivery_fee_kobo`, set by
  `create_pending_order_and_reserve_inventory`.
- `delivery_assignments` (`migration 400:285`) is **one per batch** (unique `batch_id`),
  fulfiller is rider XOR vendor, with `status public.delivery_assignment_status`.
- `riders` (`migration 300:82`): `status public.rider_status`, `active boolean` — **no
  availability flag**.
- Order status enum (DB authoritative): `...ready, out_for_delivery...`. Existing batch close
  function: `public.close_batches_at_cutoff()` (`migration 400:1148`).

---

## File Structure

- `supabase/migrations/<ts>_zone_delivery_fee.sql` (+ pgTAP) — add `delivery_fee_kobo` to zones; read it in order creation (create).
- `supabase/migrations/<ts>_promotions.sql` (+ pgTAP) — promotions + redemptions tables (create).
- `supabase/migrations/<ts>_rider_availability.sql` (+ pgTAP) — `available` flag (create).
- `supabase/migrations/<ts>_auto_dispatch.sql` (+ pgTAP) — `assign_available_rider_to_batch()` (create).
- `src/modules/promotions/*` — module, service, repository, controller, DTOs, types (create).
- `src/modules/orders/orders.service.ts` / `orders.repository.ts` — apply promo + zone fee in quote (modify).
- `src/worker/handlers/auto-dispatch.handler.ts` (+ test) — assign rider on `order.ready` (create).
- `src/worker/worker.module.ts` — register dispatch handler (modify).
- `src/modules/riders/*` — availability endpoint (modify).
- `src/domain/order-status.ts` — reconcile enum with DB (modify).

---

## Task 1: Zone-based delivery fee

**Files:**

- Create: `supabase/migrations/<ts>_zone_delivery_fee.sql`, `supabase/tests/database/zone_delivery_fee_test.sql`
- Modify: `src/modules/orders/orders.service.ts`, `src/modules/orders/orders.repository.ts`

- [ ] **Step 1: Migration — add the column + read it on order creation**

`supabase migration new zone_delivery_fee`:

```sql
begin;

alter table public.campus_zones
  add column if not exists delivery_fee_kobo integer not null default 15000
  check (delivery_fee_kobo >= 0);

-- Re-create create_pending_order_and_reserve_inventory (copy its current body) replacing the
-- hardcoded delivery fee with the order zone's fee. Resolve the zone via the order's
-- campus_location -> zone, falling back to 15000 when no zone fee is set. (Read the current
-- function body first; only the delivery-fee assignment line changes.)

commit;
```

- [ ] **Step 2: pgTAP**

`zone_delivery_fee_test.sql`: set a zone's `delivery_fee_kobo`, create an order in that zone,
assert `orders.delivery_fee_kobo` equals the zone fee (reuse the existing order-creation
fixture pattern from the order-totals pgTAP test).

- [ ] **Step 3: TS quote reads the zone fee**

Add `OrdersRepository.findZoneDeliveryFeeKobo(locationId: string): Promise<number>` (joins
`campus_locations` → `campus_zones`), and in `OrdersService.quoteOrder` pass that value as
`deliveryFeeCents` to `calculateOrderPricing` (falling back to `EnvService` `DELIVERY_FEE_KOBO`
when null). Update `test/unit/orders.service.spec.ts` to assert the quote uses the zone fee.

- [ ] **Step 4: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types && pnpm typecheck && pnpm vitest run test/unit/orders.service.spec.ts`

```bash
git add supabase/migrations supabase/tests/database/zone_delivery_fee_test.sql src/modules/orders supabase/types/database.types.ts test/unit/orders.service.spec.ts
git commit -m "feat(pricing): per-zone delivery fee for quotes and orders"
```

---

## Task 2: Promotions engine

**Files:**

- Create: `supabase/migrations/<ts>_promotions.sql`, `supabase/tests/database/promotions_test.sql`
- Create: `src/modules/promotions/{promotions.module,promotions.service,promotions.repository,promotions.controller,promotions.types}.ts`, `src/modules/promotions/dto/promotion.dto.ts`
- Create: `test/unit/promotions.service.spec.ts`, `test/integration/promotions-api.spec.ts`
- Modify: `src/modules/capability-modules.ts`, `src/modules/orders/*`

- [ ] **Step 1: Migration**

`supabase migration new promotions`:

```sql
begin;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete restrict,
  code text not null,
  discount_type text not null check (discount_type in ('fixed', 'percent')),
  discount_value integer not null check (discount_value > 0),
  min_order_kobo integer not null default 0 check (min_order_kobo >= 0),
  max_discount_kobo integer check (max_discount_kobo is null or max_discount_kobo > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_percent_range check (discount_type <> 'percent' or discount_value <= 100),
  constraint promotions_code_unique unique (code)
);

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  discount_kobo integer not null check (discount_kobo >= 0),
  created_at timestamptz not null default now(),
  constraint promotion_redemptions_order_unique unique (order_id)
);

create index promotion_redemptions_promo_user_idx
  on public.promotion_redemptions (promotion_id, user_id);

create trigger promotions_set_updated_at
before update on public.promotions
for each row execute function public.set_updated_at();

commit;
```

pgTAP asserts both tables + the percent-range and code-unique constraints.

- [ ] **Step 2: Domain validation test (test-first)**

Create `test/unit/promotions.service.spec.ts` covering: rejects expired/inactive codes,
rejects below `min_order_kobo`, computes `fixed` discount, computes `percent` discount capped
at `max_discount_kobo`, and never returns a discount exceeding the subtotal.

- [ ] **Step 3: Implement `evaluatePromotion` domain function**

Create `src/domain/promotions.ts` with a pure `evaluatePromotion(promo, subtotalKobo)` that
returns `{ discountKobo }` or throws a typed validation error, satisfying the tests. (Mirror
the style of `src/domain/pricing.ts`.)

- [ ] **Step 4: Module, repository, service, controller**

Build `src/modules/promotions/*`: repository (`findActiveByCode`, `countUserRedemptions`,
`countTotalRedemptions`, `recordRedemption`, admin CRUD), service (loads code, calls
`evaluatePromotion`, enforces usage limits), controller exposing customer
`POST /v1/promotions/validate` (preview discount for a basket) and admin CRUD under
`/v1/admin/promotions`. Register `PromotionsModule` in `capability-modules.ts`.

- [ ] **Step 5: Apply at quote + create**

Add optional `promotionCode` to `CreateOrderDto`; `OrdersService.quoteOrder` applies the
validated discount into `calculateOrderPricing({ discountCents })`. On `createOrder`, pass the
code into `create_pending_order_and_reserve_inventory` (extend the function to accept a
discount + record a `promotion_redemptions` row inside the same transaction so usage is
atomic). Add an integration test placing a discounted order and asserting the redemption row.

- [ ] **Step 6: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types && pnpm typecheck && pnpm vitest run && pnpm openapi:generate`

```bash
git add supabase/migrations supabase/tests/database/promotions_test.sql src/domain/promotions.ts src/modules/promotions src/modules/capability-modules.ts src/modules/orders test/unit/promotions.service.spec.ts test/integration/promotions-api.spec.ts supabase/types/database.types.ts docs/openapi.json docs/openapi.yaml
git commit -m "feat(promotions): server-validated promo codes applied to orders"
```

---

## Task 3: Rider availability flag

**Files:**

- Create: `supabase/migrations/<ts>_rider_availability.sql`, pgTAP
- Modify: `src/modules/riders/{riders.controller,riders.service,riders.repository}.ts`

- [ ] **Step 1: Migration**

`supabase migration new rider_availability`:

```sql
begin;
alter table public.riders
  add column if not exists available boolean not null default false;
create index if not exists riders_available_idx
  on public.riders (campus_id, available) where available;
commit;
```

pgTAP asserts the column + partial index exist.

- [ ] **Step 2: Endpoint (test-first)**

Add `PATCH /v1/rider/availability` (`{ available: boolean }`) to the rider controller,
guarded as the existing operational rider endpoints (active + verified rider). Add an
integration test toggling availability and asserting persistence.

- [ ] **Step 3: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm typecheck && pnpm vitest run test/integration/rider-api.spec.ts`

```bash
git add supabase/migrations supabase/tests/database src/modules/riders supabase/types/database.types.ts test/integration/rider-api.spec.ts
git commit -m "feat(riders): rider availability flag and toggle endpoint"
```

---

## Task 4: Auto rider dispatch

**Files:**

- Create: `supabase/migrations/<ts>_auto_dispatch.sql`, `supabase/tests/database/auto_dispatch_test.sql`
- Create: `src/worker/handlers/auto-dispatch.handler.ts`, `test/unit/auto-dispatch.spec.ts`
- Modify: `src/worker/worker.module.ts`

- [ ] **Step 1: Migration — assignment function**

`supabase migration new auto_dispatch`:

```sql
begin;

-- Assign the least-loaded available, verified, active rider in the batch's zone to the
-- batch, if it has no assignment yet. Returns the assignment id, or null when no rider is
-- available or an assignment already exists. SECURITY DEFINER, fixed search_path.
create or replace function public.assign_available_rider_to_batch(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_rider_id uuid;
  v_assignment_id uuid;
begin
  if exists (select 1 from public.delivery_assignments where batch_id = p_batch_id) then
    return null;
  end if;

  select campus_id into v_campus_id from public.delivery_batches where id = p_batch_id;
  if v_campus_id is null then
    return null;
  end if;

  select r.id into v_rider_id
  from public.riders r
  left join public.delivery_assignments a
    on a.rider_id = r.id and a.status in ('assigned', 'accepted', 'picked_up')
  where r.campus_id = v_campus_id and r.available and r.active and r.status = 'verified'
  group by r.id
  order by count(a.id) asc, r.display_name asc
  limit 1;

  if v_rider_id is null then
    return null;
  end if;

  insert into public.delivery_assignments (batch_id, rider_id, status)
  values (p_batch_id, v_rider_id, 'assigned')
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

commit;
```

pgTAP `auto_dispatch_test.sql`: seed a batch + an available verified rider, call the function,
assert an assignment is created and a second call returns null (idempotent).

- [ ] **Step 2: Handler (test-first)**

Create `test/unit/auto-dispatch.spec.ts` asserting the handler resolves the batch for the
order in the event payload and calls the repository assign function exactly once, and no-ops
when the order has no batch.

- [ ] **Step 3: Implement the handler**

Create `src/worker/handlers/auto-dispatch.handler.ts`:

```ts
import type { OutboxEvent } from '../outbox.repository.js';

export interface DispatchReads {
  findBatchIdForOrder(orderId: string): Promise<string | undefined>;
  assignAvailableRider(batchId: string): Promise<string | null>;
}

export class AutoDispatchHandler {
  constructor(private readonly reads: DispatchReads) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    const batchId = await this.reads.findBatchIdForOrder(event.aggregateId);
    if (batchId === undefined) return;
    await this.reads.assignAvailableRider(batchId);
  };
}
```

Implement `DispatchReads` against `delivery_batch_orders` (find batch) and
`assign_available_rider_to_batch` (assign). Register `AutoDispatchHandler.handle` for
`order.ready` in `worker.module.ts`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm typecheck && pnpm vitest run test/unit/auto-dispatch.spec.ts`

```bash
git add supabase/migrations supabase/tests/database/auto_dispatch_test.sql src/worker supabase/types/database.types.ts test/unit/auto-dispatch.spec.ts
git commit -m "feat(dispatch): auto-assign available rider on order ready"
```

---

## Task 5: Reconcile the TS order-status enum with the DB

**Files:**

- Modify: `src/domain/order-status.ts`, `test/unit/domain-rules.spec.ts`

- [ ] **Step 1: Update the test to the DB-authoritative statuses**

In `test/unit/domain-rules.spec.ts`, change the expected status set and transitions to match
the DB: statuses `pending_payment, paid, accepted, preparing, ready, out_for_delivery,
delivered, confirmed, administratively_completed, cancelled, expired, refunded`; transitions
per `transition_order_status` (`migration 400:916-928`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/domain-rules.spec.ts`
Expected: FAIL (current enum uses `ready_for_pickup`/`picked_up`/`completed`/`escalated`).

- [ ] **Step 3: Update the enum + transition map**

Edit `src/domain/order-status.ts` so `orderStatuses` and `allowedTransitions` mirror the DB
function exactly. Grep for removed identifiers (`ready_for_pickup`, `picked_up`, `completed`,
`escalated`) across `src/` and update references.

- [ ] **Step 4: Run full gate to verify pass; commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS.

```bash
git add src/domain/order-status.ts test/unit/domain-rules.spec.ts
git commit -m "refactor(domain): align order-status enum with database state machine"
```

---

## Self-Review

- **Spec coverage (Phase 2):** dynamic/zoned pricing → Task 1; promos → Task 2; rider
  availability → Task 3; auto-dispatch → Task 4; (enum reconciliation flagged by Phase 1) →
  Task 5. Covered.
- **Placeholder scan:** Task 1 Step 1 and Task 2 Step 5 instruct re-creating an existing DB
  function by copying its body and changing only the noted lines — grounding steps, not vague
  TODOs. All shown code is complete.
- **Type consistency:** `DispatchReads.{findBatchIdForOrder,assignAvailableRider}`,
  `AutoDispatchHandler.handle`, and the `evaluatePromotion(promo, subtotalKobo)` signature are
  used consistently between handlers, services, and tests.
