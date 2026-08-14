# Fee Model Rework with Timing Incentives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the customer delivery fee to ₦300 (₦400 for point delivery) and split it configurably between platform/rider/vendor, with rider and vendor shares gated on punctuality and every forfeit falling through to the platform.

**Architecture:** All money math lives in Postgres. Configurable amounts sit in `platform_settings` (read via `platform_setting_int`). Order creation records the fee; the `delivered` transition resolves the three shares and persists them per order; settlements read the resolved columns. A thin NestJS layer adds a settings-validation guard, the `point_delivery` order field, and a `food_was_ready` flag on the rider's pickup call.

**Tech Stack:** PostgreSQL + pgTAP, Supabase migrations, NestJS + Vitest, Zod DTOs.

**Spec:** [docs/superpowers/specs/2026-07-28-fee-model-timing-design.md](../specs/2026-07-28-fee-model-timing-design.md)

**Branch:** continue `feat/v2-wallet-dedicated-account` (single v2 cutover). New migrations use the `20260728######` prefix, applied after the slice-A `20260727######` set.

**Global constraints carried from slice A:** no Docker on the authoring machine — `pnpm db:ci` / `supabase test db` cannot run here; run them on a Docker host before merge. Regenerate `supabase/types/database.types.ts` there too. `pnpm lint`/`format:check`/`db:ci` are already red on `main` (pre-existing); do not attribute those to this work.

---

## File Structure

**Migrations (create, in order):**

- `supabase/migrations/20260728000100_fee_settings.sql` — seed the seven fee keys.
- `supabase/migrations/20260728000200_orders_fee_columns.sql` — new order columns, relaxed constraints, historical backfill.
- `supabase/migrations/20260728000300_ready_at_and_pickup_confirm.sql` — set `ready_at` on ready, add `p_food_was_ready` to the transition, store `rider_confirmed_ready`.
- `supabase/migrations/20260728000400_order_create_fee_assembly.sql` — recompute `delivery_fee_kobo` in both order-create RPCs; bump zone defaults.
- `supabase/migrations/20260728000500_resolve_delivery_shares.sql` — `resolve_order_delivery_shares` + call it from the `delivered` transition.
- `supabase/migrations/20260728000600_settlement_resolved_shares.sql` — settlements + batch earnings read resolved columns; relax `delivery_batches_earnings_formula`.

**pgTAP (create, one per migration):**

- `supabase/tests/075_fee_settings_test.sql`
- `supabase/tests/076_orders_fee_columns_test.sql`
- `supabase/tests/077_ready_at_pickup_confirm_test.sql`
- `supabase/tests/078_order_create_fee_test.sql`
- `supabase/tests/079_resolve_delivery_shares_test.sql`
- `supabase/tests/080_settlement_resolved_shares_test.sql`

**NestJS (modify):**

- `src/modules/wallets/admin-wallets.service.ts` (or wherever `updateSetting` lives) — fee-config validation guard.
- `src/modules/orders/dto/*.ts` + `orders.service.ts`/`orders.repository.ts` — `pointDelivery` on create.
- `src/modules/riders/dto/*.ts` + `riders.service.ts`/`riders.repository.ts` — `foodWasReady` on the out-for-delivery call.
- Order read mapping (`orders.types.ts` / rider + admin order serializers) — expose resolved share + timing fields.

**Docs:** regenerate `docs/openapi.json` + `docs/openapi.yaml` via `pnpm openapi:generate` (or the repo's script).

---

## Task 1: Seed fee settings

**Files:**

- Create: `supabase/migrations/20260728000100_fee_settings.sql`
- Test: `supabase/tests/075_fee_settings_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/075_fee_settings_test.sql
begin;
select plan(8);

select is(public.platform_setting_int('fee_delivery_base_kobo', -1), 30000, 'base fee seeded');
select is(public.platform_setting_int('fee_point_surcharge_kobo', -1), 10000, 'point surcharge seeded');
select is(public.platform_setting_int('share_rider_ontime_kobo', -1), 10000, 'rider on-time seeded');
select is(public.platform_setting_int('share_rider_late_kobo', -1), 5000, 'rider late seeded');
select is(public.platform_setting_int('share_vendor_ontime_kobo', -1), 5000, 'vendor on-time seeded');
select is(public.platform_setting_int('share_point_rider_kobo', -1), 5000, 'point rider seeded');
select is(public.platform_setting_int('vendor_ready_lead_minutes', -1), 10, 'lead minutes seeded');
select is(public.platform_setting_int('missing_key_xyz', 42), 42, 'default fallback still works');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it, expect failure**

Run: `supabase test db` (Docker host). Expected: FAIL — keys absent, returns the `-1` defaults.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260728000100_fee_settings.sql
begin;

insert into public.platform_settings (key, value, description) values
  ('fee_delivery_base_kobo',   to_jsonb(30000), 'Base customer delivery fee in kobo (₦300).'),
  ('fee_point_surcharge_kobo', to_jsonb(10000), 'Extra charged for point delivery (hostel room / classroom), in kobo (₦100).'),
  ('share_rider_ontime_kobo',  to_jsonb(10000), 'Rider delivery share when delivered on time (₦100).'),
  ('share_rider_late_kobo',    to_jsonb(5000),  'Rider delivery share when delivered late (₦50); the ₦50 difference forfeits to the platform.'),
  ('share_vendor_ontime_kobo', to_jsonb(5000),  'Vendor cooking share when food is ready early enough (₦50); forfeits to platform otherwise.'),
  ('share_point_rider_kobo',   to_jsonb(5000),  'Portion of the point surcharge paid to the fulfiller for the extra distance (₦50). Not timing-gated.'),
  ('vendor_ready_lead_minutes',to_jsonb(10),    'Minutes before the slot target the vendor must mark food ready to earn the cooking share.')
on conflict (key) do nothing;

commit;
```

- [ ] **Step 4: Run test, expect pass.** Run: `supabase test db`. Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000100_fee_settings.sql supabase/tests/075_fee_settings_test.sql
git commit -m "feat(fee): seed configurable delivery-fee split settings"
```

---

## Task 2: Order fee columns, relaxed constraints, historical backfill

**Files:**

- Create: `supabase/migrations/20260728000200_orders_fee_columns.sql`
- Test: `supabase/tests/076_orders_fee_columns_test.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/076_orders_fee_columns_test.sql
begin;
select plan(6);

select has_column('public', 'orders', 'point_delivery', 'point_delivery added');
select has_column('public', 'orders', 'ready_at', 'ready_at added');
select has_column('public', 'orders', 'rider_delivery_share_kobo', 'rider share col added');
select has_column('public', 'orders', 'vendor_delivery_share_kobo', 'vendor share col added');

-- a NEW order may carry the ₦300 fee (old constraint pinned it to 15000)
select lives_ok(
  $$ update public.orders set delivery_fee_kobo = 30000
     where id = (select id from public.orders limit 1) $$,
  'delivery_fee_kobo = 30000 now allowed');

-- resolved shares must sum to the fee when all three are set
select throws_ok(
  $$ update public.orders
       set rider_delivery_share_kobo = 10000,
           vendor_delivery_share_kobo = 5000,
           platform_delivery_share_kobo = 99999,
           delivery_fee_kobo = 30000
     where id = (select id from public.orders limit 1) $$,
  '23514',
  null,
  'unbalanced resolved shares rejected');

select * from finish();
rollback;
```

> Note: seed at least one order row in the test fixture harness if the suite runs against an empty DB. Follow the pattern in the existing `07x` wallet tests, which build their own fixtures.

- [ ] **Step 2: Run, expect fail** (`supabase test db`) — columns/constraints not present.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260728000200_orders_fee_columns.sql
begin;

alter table public.orders
  add column point_delivery boolean not null default false,
  add column ready_at timestamptz,
  add column rider_confirmed_ready boolean,
  add column rider_delivery_share_kobo integer,
  add column vendor_delivery_share_kobo integer,
  add column ready_on_time boolean,
  add column delivered_on_time boolean;

comment on column public.orders.point_delivery is 'Customer opted into delivery to a specific point (hostel room / classroom); adds the point surcharge.';
comment on column public.orders.ready_at is 'When the vendor marked the food ready. Set on the -> ready transition.';
comment on column public.orders.rider_confirmed_ready is 'Rider''s confirmation at pickup that the food was actually ready. Null until pickup.';
comment on column public.orders.rider_delivery_share_kobo is 'Resolved rider delivery share (on-time/late + point portion). Null until delivered.';
comment on column public.orders.vendor_delivery_share_kobo is 'Resolved vendor share (cooking bonus, plus delivery share in vendor_delivery mode). Null until delivered.';
comment on column public.orders.platform_delivery_share_kobo is 'Resolved platform residual = delivery_fee - rider - vendor, absorbing all forfeits. Set at delivered.';

-- broaden room_number to be the point-delivery label
comment on column public.orders.room_number is 'Optional point-delivery label — hostel room, classroom, or other specific spot.';

-- relax the flat-fee / fixed-split pins; keep non-negativity
alter table public.orders drop constraint orders_money_non_negative;
alter table public.orders add constraint orders_money_non_negative check (
  food_subtotal_kobo >= 0
  and delivery_fee_kobo >= 0
  and platform_delivery_share_kobo >= 0
  and fulfiller_delivery_share_kobo >= 0
  and coalesce(rider_delivery_share_kobo, 0) >= 0
  and coalesce(vendor_delivery_share_kobo, 0) >= 0
  and discount_kobo >= 0
  and total_kobo >= 0
);

-- Newly resolved orders must have shares that sum to the fee. Scoped by delivered_on_time
-- (set by the resolution function, NOT by the backfill) so historical rows whose per-zone
-- delivery_fee != 15000 with pinned 7500/7500 shares are exempt and the migration cannot abort.
alter table public.orders add constraint orders_resolved_shares_balance check (
  delivered_on_time is null
  or (rider_delivery_share_kobo + vendor_delivery_share_kobo + platform_delivery_share_kobo = delivery_fee_kobo)
);

-- backfill terminal historical rows: map the flat fulfiller share by mode
update public.orders o
set rider_delivery_share_kobo = case when o.delivery_mode = 'meal_direct_rider' then o.fulfiller_delivery_share_kobo else 0 end,
    vendor_delivery_share_kobo = case when o.delivery_mode = 'vendor_delivery' then o.fulfiller_delivery_share_kobo else 0 end
where o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
  and o.rider_delivery_share_kobo is null;

commit;
```

> **Schema-drift note (confirmed during implementation):** the live `orders_money_non_negative` was already relaxed twice after `20260612000400` and now also carries `service_fee_kobo >= 0`; the live `orders_total_formula` includes `service_fee_kobo` and `large_order_surcharge_kobo`. Read the CURRENT constraint text before rewriting and preserve every existing `>= 0` guard.
> **Why `delivered_on_time` scopes the balance check:** historical orders keep pinned 7500/7500 shares, but since the delivery fee went per-zone a historical row can have `delivery_fee_kobo != 15000`, so those shares do NOT sum to the fee. The backfill sets only rider/vendor and leaves `delivered_on_time` null, so those rows are exempt and the migration cannot abort. The resolution function (Task 5) sets `delivered_on_time` together with all three balanced shares, so the invariant is enforced on every new order.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000200_orders_fee_columns.sql supabase/tests/076_orders_fee_columns_test.sql
git commit -m "feat(fee): add resolved-share order columns, relax fee constraints, backfill history"
```

---

## Task 3: `ready_at` on ready; rider pickup confirmation

**Files:**

- Create: `supabase/migrations/20260728000300_ready_at_and_pickup_confirm.sql`
- Test: `supabase/tests/077_ready_at_pickup_confirm_test.sql`
- Reference: `supabase/migrations/20260619000900_emit_order_lifecycle_events.sql` (current `transition_order_status`)

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/077_ready_at_pickup_confirm_test.sql
begin;
select plan(3);

-- driving an order to 'ready' stamps ready_at
-- (fixture: an accepted+preparing order id in :order_id)
select transition_order_status(:'order_id', 'ready');
select isnt((select ready_at from public.orders where id = :'order_id'), null, 'ready_at stamped on ready');

-- pickup with the confirmation flag stores it
select transition_order_status(:'order_id', 'out_for_delivery', p_food_was_ready => true);
select is((select rider_confirmed_ready from public.orders where id = :'order_id'), true, 'pickup confirmation stored');

-- default is true when omitted
select is(
  (select public.transition_order_status is not null), true, 'transition callable with default flag');

select * from finish();
rollback;
```

- [ ] **Step 2: Run, expect fail** — new arg/columns not wired.

- [ ] **Step 3: Write the migration** (re-create `transition_order_status` with the new optional arg + timestamp writes; preserve the existing status matrix and event emission verbatim, adding only the marked lines)

```sql
-- supabase/migrations/20260728000300_ready_at_and_pickup_confirm.sql
begin;

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_food_was_ready boolean default true          -- NEW
)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_status public.order_status;
begin
  select order_status into v_from_status from public.orders where id = p_order_id;
  if v_from_status is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  if v_from_status = p_to_status then
    return p_to_status;
  end if;

  if not (
    (v_from_status = 'pending_payment' and p_to_status in ('paid', 'expired', 'cancelled')) or
    (v_from_status = 'paid' and p_to_status in ('accepted', 'cancelled', 'refunded')) or
    (v_from_status = 'accepted' and p_to_status in ('preparing', 'cancelled')) or
    (v_from_status = 'preparing' and p_to_status in ('ready', 'cancelled')) or
    (v_from_status = 'ready' and p_to_status in ('out_for_delivery', 'cancelled')) or
    (v_from_status = 'out_for_delivery' and p_to_status in ('delivered', 'cancelled')) or
    (v_from_status = 'delivered' and p_to_status in ('confirmed', 'refunded')) or
    (v_from_status = 'confirmed' and p_to_status = 'refunded')
  ) then
    raise exception 'illegal order transition % -> %', v_from_status, p_to_status using errcode = '23514';
  end if;

  update public.orders
  set order_status = p_to_status,
      ready_at = case when p_to_status = 'ready' then now() else ready_at end,                         -- NEW
      rider_confirmed_ready = case when p_to_status = 'out_for_delivery' then p_food_was_ready
                                   else rider_confirmed_ready end,                                       -- NEW
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      accepted_at = case when p_to_status = 'accepted' then now() else accepted_at end,
      paid_at = case when p_to_status = 'paid' then now() else paid_at end,
      cancelled_at = case when p_to_status = 'cancelled' then now() else cancelled_at end,
      confirmed_at = case when p_to_status = 'confirmed' then now() else confirmed_at end,
      updated_at = now()
  where id = p_order_id;

  perform public.emit_order_lifecycle_event(p_order_id, v_from_status, p_to_status);

  return p_to_status;
end;
$$;

commit;
```

> **Verify against the live function before writing.** Read `20260619000900_emit_order_lifecycle_events.sql` and the money migration's original `transition_order_status`; copy the exact `update` assignments and the exact event-emit call name it currently uses (`emit_order_lifecycle_event` vs inline event insert). Only add the two NEW lines and the new parameter. Do not drop any assignment that already exists.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000300_ready_at_and_pickup_confirm.sql supabase/tests/077_ready_at_pickup_confirm_test.sql
git commit -m "feat(fee): stamp ready_at and capture rider pickup confirmation"
```

---

## Task 4: Order-create fee assembly (₦300 + point surcharge)

**Files:**

- Create: `supabase/migrations/20260728000400_order_create_fee_assembly.sql`
- Test: `supabase/tests/078_order_create_fee_test.sql`
- Reference: `supabase/migrations/20260706000200_order_soup_and_max_quantity.sql` (current `create_pending_order_and_reserve_inventory`), `supabase/migrations/20260727000300_create_paid_order_from_wallet.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/078_order_create_fee_test.sql
begin;
select plan(3);

-- standard order picks up the ₦300 base
-- (call create_pending_order_and_reserve_inventory with point_delivery => false)
select is(
  (select delivery_fee_kobo from public.orders where id = :'std_order_id'),
  30000, 'standard order fee is base ₦300');

-- point delivery adds the ₦100 surcharge
select is(
  (select delivery_fee_kobo from public.orders where id = :'point_order_id'),
  40000, 'point order fee is ₦400');

select is(
  (select total_kobo from public.orders where id = :'point_order_id'),
  (select food_subtotal_kobo + 40000 - discount_kobo from public.orders where id = :'point_order_id'),
  'total reflects the point fee');

select * from finish();
rollback;
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Write the migration.** Re-create both RPCs. In each, replace the delivery-fee assignment. For `create_pending_order_and_reserve_inventory` add a `p_point_delivery boolean default false` parameter and change the fee read:

```sql
-- inside create_pending_order_and_reserve_inventory, replacing the current
--   select cl.zone_id, coalesce(cz.delivery_fee_kobo, 15000) into v_location_zone_id, v_delivery_fee ...
select cl.zone_id,
       coalesce(cz.delivery_fee_kobo, public.platform_setting_int('fee_delivery_base_kobo', 30000))
       + case when p_point_delivery then public.platform_setting_int('fee_point_surcharge_kobo', 10000) else 0 end
into v_location_zone_id, v_delivery_fee
from public.campus_locations cl
join public.campus_zones cz on cz.id = cl.zone_id
where cl.id = p_location_id;
```

Then persist the new column in the `insert into public.orders (...)` column list: add `point_delivery` with value `p_point_delivery`. Do the identical fee change (and `point_delivery`) in `create_paid_order_from_wallet`, adding its own `p_point_delivery boolean default false` parameter and including the surcharge so the wallet debit and balance check use the ₦400 total.

Also bump existing zone rows so live zones charge ₦300 by default:

```sql
update public.campus_zones set delivery_fee_kobo = 30000 where delivery_fee_kobo = 15000;
```

> **Verify the full parameter lists** of both functions before re-creating them — they are long (campus, service date, slot, items jsonb, etc.). Preserve every existing parameter and body line; add only `p_point_delivery` and the two fee changes. Keep the `least(cutoff, now()+15min)` reservation logic and all inventory/promo logic intact.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000400_order_create_fee_assembly.sql supabase/tests/078_order_create_fee_test.sql
git commit -m "feat(fee): charge ₦300 base plus ₦100 point surcharge at order creation"
```

---

## Task 5: Resolve the three shares at delivery

**Files:**

- Create: `supabase/migrations/20260728000500_resolve_delivery_shares.sql`
- Test: `supabase/tests/database/104_resolve_delivery_shares_test.sql`

> **CRITICAL blocker (found during implementation): the `protect_order_financial_history` trigger.**
> It rejects any post-payment change to `platform_delivery_share_kobo` / `fulfiller_delivery_share_kobo`,
> so the resolver's UPDATE at `delivered` is blocked. This migration must ALSO `create or replace`
> `protect_order_financial_history` to drop those two split columns from its guarded set (keep
> `order_number`, `food_subtotal_kobo`, `delivery_fee_kobo`, `discount_kobo`, `total_kobo`, `currency`
> guarded). Do NOT re-create the trigger, only the function. The internal split is resolved at delivery
> by design and is no longer a payment-time snapshot; the customer-paid amounts stay immutable.

- [ ] **Step 1: Write the failing test** (cover the four rider-mode outcomes, the two vendor-delivery outcomes, point delivery, and the residual/invariant)

```sql
-- supabase/tests/079_resolve_delivery_shares_test.sql
begin;
select plan(9);

-- Helper expectation table. Fixtures build orders at a known slot target,
-- set ready_at / delivered_at / rider_confirmed_ready, drive to delivered,
-- then read the resolved columns.

-- rider mode, both on time, standard fee 30000
select is((select rider_delivery_share_kobo from public.orders where id=:'r_on_von'), 10000, 'rider on-time = 100');
select is((select vendor_delivery_share_kobo from public.orders where id=:'r_on_von'), 5000, 'vendor on-time = 50');
select is((select platform_delivery_share_kobo from public.orders where id=:'r_on_von'), 15000, 'platform residual = 150');

-- rider mode, rider late + vendor missed -> platform absorbs both
select is((select rider_delivery_share_kobo from public.orders where id=:'r_late_vmiss'), 5000, 'rider late = 50');
select is((select vendor_delivery_share_kobo from public.orders where id=:'r_late_vmiss'), 0, 'vendor missed = 0');
select is((select platform_delivery_share_kobo from public.orders where id=:'r_late_vmiss'), 25000, 'platform = 250');

-- point delivery, rider on time: rider 100+50, platform 150+50, vendor 50, fee 40000
select is((select rider_delivery_share_kobo from public.orders where id=:'r_point'), 15000, 'rider gets point portion');
select is((select platform_delivery_share_kobo from public.orders where id=:'r_point'), 20000, 'platform gets point remainder');

-- vendor_delivery mode, ready early + delivered on time: vendor 50+100, platform 150
select is((select vendor_delivery_share_kobo from public.orders where id=:'vendor_mode'), 15000, 'self-delivery vendor gets both shares');

select * from finish();
rollback;
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260728000500_resolve_delivery_shares.sql
begin;

create or replace function public.resolve_order_delivery_shares(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_tz text;
  v_target timestamptz;
  v_lead int := public.platform_setting_int('vendor_ready_lead_minutes', 10);
  v_rider_on int := public.platform_setting_int('share_rider_ontime_kobo', 10000);
  v_rider_late int := public.platform_setting_int('share_rider_late_kobo', 5000);
  v_vendor_on int := public.platform_setting_int('share_vendor_ontime_kobo', 5000);
  v_point int := public.platform_setting_int('share_point_rider_kobo', 5000);
  v_ready_ok boolean;
  v_deliv_ok boolean;
  v_rider int;
  v_vendor int;
  v_platform int;
begin
  select ord.*, c.timezone as campus_tz, s.delivery_time
  into o
  from public.orders ord
  join public.campuses c on c.id = ord.campus_id
  join public.delivery_slots s on s.id = ord.delivery_slot_id
  where ord.id = p_order_id;

  v_tz := coalesce(o.campus_tz, 'Africa/Lagos');
  v_target := (o.service_date + o.delivery_time) at time zone v_tz;

  v_ready_ok := o.ready_at is not null and o.ready_at <= v_target - make_interval(mins => v_lead);
  v_deliv_ok := o.delivered_at is not null and o.delivered_at <= v_target;

  if o.delivery_mode = 'meal_direct_rider' then
    v_rider := (case when v_deliv_ok then v_rider_on else v_rider_late end)
             + (case when o.point_delivery then v_point else 0 end);
    v_vendor := case when v_ready_ok and o.rider_confirmed_ready is true then v_vendor_on else 0 end;
  else  -- vendor_delivery: the vendor cooks and delivers
    v_vendor := (case when v_ready_ok then v_vendor_on else 0 end)
              + (case when v_deliv_ok then v_rider_on else v_rider_late end)
              + (case when o.point_delivery then v_point else 0 end);
    v_rider := 0;
  end if;

  v_platform := o.delivery_fee_kobo - v_rider - v_vendor;

  if v_platform < 0 or v_rider < 0 or v_vendor < 0
     or (v_rider + v_vendor + v_platform) <> o.delivery_fee_kobo then
    raise exception 'delivery share resolution unbalanced for order % (fee %, rider %, vendor %, platform %)',
      p_order_id, o.delivery_fee_kobo, v_rider, v_vendor, v_platform using errcode = '23000';
  end if;

  update public.orders
  set rider_delivery_share_kobo = v_rider,
      vendor_delivery_share_kobo = v_vendor,
      platform_delivery_share_kobo = v_platform,
      ready_on_time = v_ready_ok,
      delivered_on_time = v_deliv_ok,
      updated_at = now()
  where id = p_order_id;
end;
$$;

comment on function public.resolve_order_delivery_shares(uuid) is 'Resolves and persists the rider/vendor/platform delivery split from timing, mode and point flag at delivery. Platform is the residual and absorbs all forfeits.';

-- call it from the transition when an order reaches delivered
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_food_was_ready boolean default true
)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_status public.order_status;
  v_result public.order_status;
begin
  -- (identical body to Task 3; re-paste it verbatim here, then add the two lines below
  --  immediately before `return p_to_status;`)
  -- ...
  if p_to_status = 'delivered' then
    perform public.resolve_order_delivery_shares(p_order_id);
  end if;
  return p_to_status;
end;
$$;

commit;
```

> **Do not leave the body as a comment.** Copy the full Task-3 `transition_order_status` body in, then insert the `if p_to_status = 'delivered' then perform ... end if;` call after the `update`/event-emit and before the final `return`. The resolution must run after `delivered_at` is stamped.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000500_resolve_delivery_shares.sql supabase/tests/079_resolve_delivery_shares_test.sql
git commit -m "feat(fee): resolve rider/vendor/platform split at delivery with platform residual"
```

---

## Task 6: Settlements & batch earnings read resolved shares

**Files:**

- Create: `supabase/migrations/20260728000600_settlement_resolved_shares.sql`
- Test: `supabase/tests/080_settlement_resolved_shares_test.sql`
- Reference: `supabase/migrations/20260612000400_orders_payments_batches_settlements.sql` (`produce_vendor_daily_settlement`, `produce_rider_daily_settlement`, `calculate_delivery_earnings`, `finalize_delivery_batch`, `delivery_batches_earnings_formula`)

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/080_settlement_resolved_shares_test.sql
begin;
select plan(4);

-- rider settlement sums resolved rider shares (mix of on-time and late)
select is(
  (select delivery_earnings_kobo from public.settlements where rider_id = :'rider_id' and settlement_date = :'d'),
  15000, 'rider settlement = 100 + 50 across two orders');

-- rider_delivery line uses the resolved per-order value
select is(
  (select amount_kobo from public.settlement_lines l join public.settlements s on s.id=l.settlement_id
   where s.rider_id=:'rider_id' and l.order_id=:'ontime_order' and l.line_type='rider_delivery'),
  10000, 'rider line = resolved 100');

-- vendor settlement delivery line uses resolved vendor share (cooking bonus)
select is(
  (select amount_kobo from public.settlement_lines l join public.settlements s on s.id=l.settlement_id
   where s.vendor_id=:'vendor_id' and l.order_id=:'ontime_order' and l.line_type='vendor_delivery'),
  5000, 'vendor line = resolved cooking 50');

-- batch earnings equal the sum of resolved rider shares (formula relaxed)
select is(
  (select delivery_earnings_kobo from public.delivery_batches where id = :'batch_id'),
  15000, 'batch earnings = sum of resolved rider shares');

select * from finish();
rollback;
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Write the migration.** Relax the batch formula and re-create the three functions to read the resolved columns:

```sql
-- supabase/migrations/20260728000600_settlement_resolved_shares.sql
begin;

-- 1) relax the flat batch-earnings formula
alter table public.delivery_batches drop constraint delivery_batches_earnings_formula;
alter table public.delivery_batches add constraint delivery_batches_earnings_non_negative
  check (delivery_earnings_kobo >= 0);

-- 2) batch finalize: earnings = sum of resolved rider shares in the batch
--    Re-create finalize_delivery_batch, replacing the
--      delivery_earnings_kobo = public.calculate_delivery_earnings(batch_counts.order_count)
--    assignment with a sum over resolved rider shares:
--      delivery_earnings_kobo = (
--        select coalesce(sum(o.rider_delivery_share_kobo), 0)
--        from public.delivery_batch_orders dbo
--        join public.orders o on o.id = dbo.order_id
--        where dbo.batch_id = <batch id>
--      )
--    (Read the current finalize_delivery_batch body and swap only that line.)

-- 3) rider settlement: sum rider_delivery_share_kobo instead of fulfiller_delivery_share_kobo
--    Re-create produce_rider_daily_settlement, changing both the SUM and the
--    settlement_lines 'rider_delivery' amount from
--      o.fulfiller_delivery_share_kobo  ->  coalesce(o.rider_delivery_share_kobo, 0)

-- 4) vendor settlement: the 'vendor_delivery' line uses resolved vendor share,
--    and it now applies to BOTH modes (cooking bonus even when a rider delivered).
--    Re-create produce_vendor_daily_settlement:
--      - drop the `and o.delivery_mode = 'vendor_delivery'` filter on the vendor_delivery line
--      - change amount from o.fulfiller_delivery_share_kobo -> coalesce(o.vendor_delivery_share_kobo, 0)
--      - skip rows where coalesce(o.vendor_delivery_share_kobo,0) = 0 to avoid ₦0 lines

commit;
```

> Each of items 2–4 is a full `create or replace function` — read the current body from `20260612000400_orders_payments_batches_settlements.sql`, paste it whole, and change only the lines named above. Provide the complete function bodies in the migration (the comments here mark the exact edits, not placeholders to leave in the file).

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000600_settlement_resolved_shares.sql supabase/tests/080_settlement_resolved_shares_test.sql
git commit -m "feat(fee): pay settlements and batch earnings from resolved delivery shares"
```

---

## Task 7: Settings-update validation guard (Nest)

**Files:**

- Modify: `src/modules/wallets/admin-wallets.service.ts` (the `updateSetting` method) — confirm exact location first with `grep -rn "async updateSetting" src/modules/wallets`.
- Test: colocated `*.spec.ts` for that service (follow the existing wallet service spec).

- [ ] **Step 1: Write the failing unit test**

```ts
// in admin-wallets.service.spec.ts (or wherever updateSetting is tested)
it('rejects a fee config whose shares exceed the base', async () => {
  await expect(service.updateSetting(actor, 'share_rider_ontime_kobo', 999_999)).rejects.toThrow(
    /exceed|residual|invalid/i
  );
});

it('rejects a negative fee setting', async () => {
  await expect(service.updateSetting(actor, 'fee_delivery_base_kobo', -1)).rejects.toThrow(
    /negative|invalid/i
  );
});

it('accepts the seeded defaults', async () => {
  await expect(
    service.updateSetting(actor, 'share_vendor_ontime_kobo', 5_000)
  ).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run, expect fail.** Run: `pnpm test admin-wallets` (or the matching spec). Expected: FAIL — no guard.

- [ ] **Step 3: Implement the guard.** In `updateSetting`, before writing, validate fee keys:

```ts
private static readonly FEE_KEYS = new Set([
  'fee_delivery_base_kobo', 'fee_point_surcharge_kobo',
  'share_rider_ontime_kobo', 'share_rider_late_kobo',
  'share_vendor_ontime_kobo', 'share_point_rider_kobo',
  'vendor_ready_lead_minutes',
]);

private async assertFeeConfigValid(key: string, value: number): Promise<void> {
  if (!AdminWalletsService.FEE_KEYS.has(key)) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException({ code: 'INVALID_FEE_SETTING', message: `${key} must be a non-negative integer` });
  }
  if (key === 'vendor_ready_lead_minutes' && value <= 0) {
    throw new BadRequestException({ code: 'INVALID_FEE_SETTING', message: 'vendor_ready_lead_minutes must be positive' });
  }
  // platform residual must stay >= 0: rider_ontime + vendor_ontime <= base
  const current = await this.settings.readMany([
    'fee_delivery_base_kobo', 'share_rider_ontime_kobo', 'share_vendor_ontime_kobo',
  ]);
  const base = key === 'fee_delivery_base_kobo' ? value : current.fee_delivery_base_kobo ?? 30_000;
  const riderOn = key === 'share_rider_ontime_kobo' ? value : current.share_rider_ontime_kobo ?? 10_000;
  const vendorOn = key === 'share_vendor_ontime_kobo' ? value : current.share_vendor_ontime_kobo ?? 5_000;
  if (riderOn + vendorOn > base) {
    throw new BadRequestException({ code: 'INVALID_FEE_SETTING', message: 'rider + vendor on-time shares exceed the base delivery fee (platform residual would be negative)' });
  }
}
```

Call `await this.assertFeeConfigValid(key, value)` at the top of `updateSetting`. If `platform-settings.repository.ts` lacks a `readMany`, add a small method that selects the given keys as integers (reuse the `platform_setting_int` semantics or a direct select).

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/modules/wallets
git commit -m "feat(fee): validate fee settings so the platform residual can never go negative"
```

---

## Task 8: `pointDelivery` on order creation (Nest)

**Files:**

- Modify: `src/modules/orders/dto/*create*.ts` (create-order DTO), `orders.service.ts`, `orders.repository.ts`.
- Test: orders service/controller spec.

- [ ] **Step 1: Write the failing test**

```ts
it('passes pointDelivery through to the create RPC', async () => {
  const spy = vi.spyOn(repository, 'createPendingOrder'); // exact name per repo
  await service.createOrder(actor, { ...validCreateDto, pointDelivery: true });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ pointDelivery: true }));
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.** Add to the create-order DTO:

```ts
@ApiPropertyOptional({ description: 'Deliver to a specific point (hostel room / classroom). Adds the point surcharge.' })
@IsOptional()
@IsBoolean()
pointDelivery?: boolean;
```

Thread it through the service into the repository call, and add `p_point_delivery => $n` to the `create_pending_order_and_reserve_inventory` invocation in `orders.repository.ts` (default false). Do the same for any wallet-paid create path that calls `create_paid_order_from_wallet`.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/modules/orders
git commit -m "feat(fee): accept pointDelivery on order creation and pass it to the RPC"
```

---

## Task 9: `foodWasReady` on the rider pickup call (Nest)

**Files:**

- Modify: `src/modules/riders/riders.service.ts:447` (the `out_for_delivery` transition), `riders.repository.ts:585` (`transitionAssignedOrderStatus`), rider pickup DTO/controller.
- Test: riders service spec.

- [ ] **Step 1: Write the failing test**

```ts
it('forwards foodWasReady=false to the transition RPC on pickup', async () => {
  const spy = vi.spyOn(repository, 'transitionAssignedOrderStatus');
  await service.markOutForDelivery(actor, orderId, { foodWasReady: false });
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'out_for_delivery', foodWasReady: false })
  );
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.** Add an optional `foodWasReady?: boolean` (default true) to the pickup DTO; thread it into `transitionOrderForProfile(... 'out_for_delivery' ...)` and down to `transitionAssignedOrderStatus`, which passes `p_food_was_ready => $n` to `transition_order_status`. Only the `out_for_delivery` call carries it; other transitions keep the default.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/modules/riders
git commit -m "feat(fee): let riders confirm food-was-ready at pickup for the vendor bonus"
```

---

## Task 10: Expose resolved + timing fields on order reads (Nest)

**Files:**

- Modify: `src/modules/orders/orders.types.ts` (+ admin/rider order serializers that select order columns).
- Test: mapping/serializer spec.

- [ ] **Step 1: Write the failing test**

```ts
it('maps resolved share and timing fields on an order read', () => {
  const row = {
    ...baseRow,
    rider_delivery_share_kobo: 10000,
    vendor_delivery_share_kobo: 5000,
    platform_delivery_share_kobo: 15000,
    ready_on_time: true,
    delivered_on_time: true,
    point_delivery: false
  };
  const dto = mapOrder(row);
  expect(dto.riderDeliveryShareKobo).toBe(10000);
  expect(dto.deliveredOnTime).toBe(true);
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.** Add the new fields to the order read type + mapper (`riderDeliveryShareKobo`, `vendorDeliveryShareKobo`, `platformDeliveryShareKobo`, `readyOnTime`, `deliveredOnTime`, `pointDelivery`), and include the columns in the repository `select`s that back admin/vendor/rider order reads. No new endpoints.

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/modules/orders
git commit -m "feat(fee): expose resolved delivery shares and punctuality on order reads"
```

---

## Task 11: OpenAPI + full green gate

- [ ] **Step 1: Regenerate OpenAPI**

Run: `pnpm openapi:generate` (confirm the exact script name in `package.json`; slice A used an `openapi` script). Then `pnpm openapi:check`. Expected: exit 0, `docs/openapi.json` + `docs/openapi.yaml` updated with `pointDelivery`, `foodWasReady`, and the new order read fields.

- [ ] **Step 2: Typecheck + unit tests**

Run: `pnpm typecheck` (expect clean) and `pnpm test` (expect all green, no new failures vs the slice-A baseline of 467 passed / 1 skipped plus the specs added here).

- [ ] **Step 3: Commit**

```bash
git add docs/openapi.json docs/openapi.yaml
git commit -m "docs(fee): regenerate OpenAPI for the ₦300 fee model"
```

---

## Task 12: Pre-merge DB verification (Docker host)

> This task CANNOT run on the authoring machine (no Docker). It is the gate before merge.

- [ ] **Step 1:** On a Docker host, run `pnpm db:ci` (or `supabase test db`). Expected: the six new `075`–`080` suites pass. Note the pre-existing red migrations (20260703–20260707) are not from this work.
- [ ] **Step 2:** Regenerate `supabase/types/database.types.ts` (`supabase gen types ...` per repo script) so the new columns/args are typed; run `pnpm typecheck` again; commit the regenerated types.
- [ ] **Step 3:** Fix any SQL error surfaced (the most likely: a wrong SQLSTATE in a `throws_ok`, or a settlement function whose original body was mis-copied). Re-run until green.
- [ ] **Step 4:** Proceed to `superpowers:finishing-a-development-branch` / open the PR.

---

## Self-Review notes (author)

- **Spec coverage:** ₦300 base + point surcharge (T4), configurable shares (T1), timing gates + rider confirmation (T3+T5), platform residual + forfeits (T5), vendor_delivery both-shares (T5), settlements + batch (T6), settings guard (T7), point-delivery order field (T2+T8), analytics fields (T10), backfill (T2). All spec sections map to a task.
- **Type consistency:** RPC arg `p_point_delivery` / `p_food_was_ready` used consistently across T3–T9; DTO names `pointDelivery` / `foodWasReady`; resolved columns `rider_delivery_share_kobo` / `vendor_delivery_share_kobo` / `platform_delivery_share_kobo` consistent T2→T10.
- **Known follow-through for the executor:** T3, T4, T5, T6 each require reading the _current_ function body and re-pasting it whole with the marked edits — the plan names every edit but the executor must copy the surrounding body verbatim (these functions are long and their full text is in the referenced migrations). Do not ship a function that drops existing logic.
