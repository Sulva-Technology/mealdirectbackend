begin;

-- v2 fee-model timing: add the resolved delivery-share columns and readiness/timeliness
-- flags to orders, relax the flat-fee pins that the pilot baked into orders_money_non_negative,
-- add a balance invariant for the resolved shares, and backfill history so the invariant holds.

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
comment on column public.orders.room_number is 'Optional point-delivery label — hostel room, classroom, or other specific spot.';

-- Relax the money check: drop the flat 7500/7500 pins on the delivery shares so the v2 model
-- can resolve them, keep every non-negativity guarantee that exists today (including the
-- service_fee_kobo >= 0 guarantee added in 20260625000400), and guard the new nullable shares.
alter table public.orders drop constraint orders_money_non_negative;
alter table public.orders add constraint orders_money_non_negative check (
  food_subtotal_kobo >= 0
  and delivery_fee_kobo >= 0
  and service_fee_kobo >= 0
  and platform_delivery_share_kobo >= 0
  and fulfiller_delivery_share_kobo >= 0
  and coalesce(rider_delivery_share_kobo, 0) >= 0
  and coalesce(vendor_delivery_share_kobo, 0) >= 0
  and discount_kobo >= 0
  and total_kobo >= 0
);

-- Once an order is resolved by the v2 resolution logic, the three delivery shares must
-- reconstruct the delivery fee exactly (the platform share is the residual). Keyed on
-- delivered_on_time, which resolve_order_delivery_shares (Task 5) sets together with all three
-- balanced shares: the constraint is enforced exactly on newly-resolved orders. The historical
-- backfill below sets only rider/vendor shares and leaves delivered_on_time null, so backfilled
-- rows are exempt regardless of their delivery_fee (pilot rows pinned 7500/7500 shares that never
-- summed to a per-zone fee != 15000). platform_delivery_share_kobo is NOT NULL (default 7500), so
-- once delivered_on_time is set the sum is never nulled.
alter table public.orders add constraint orders_resolved_shares_balance check (
  delivered_on_time is null
  or (rider_delivery_share_kobo + vendor_delivery_share_kobo + platform_delivery_share_kobo = delivery_fee_kobo)
);

-- Backfill completed history. During the pilot every completed order carried the pinned
-- platform_delivery_share_kobo = 7500 and fulfiller_delivery_share_kobo = 7500 against a
-- 15000 delivery fee, so resolving the fulfiller's 7500 to the rider or the vendor (by mode)
-- leaves the balance invariant satisfied: 7500 + 0 + 7500 = 15000 and 0 + 7500 + 7500 = 15000.
update public.orders o
set rider_delivery_share_kobo = case when o.delivery_mode = 'meal_direct_rider' then o.fulfiller_delivery_share_kobo else 0 end,
    vendor_delivery_share_kobo = case when o.delivery_mode = 'vendor_delivery' then o.fulfiller_delivery_share_kobo else 0 end
where o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
  and o.rider_delivery_share_kobo is null;

commit;
