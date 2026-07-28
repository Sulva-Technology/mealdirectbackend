begin;

-- Fee-model migration Task 5: resolve the three delivery shares (rider / vendor / platform)
-- at the moment an order is delivered.
--
-- The platform share is the residual: platform = delivery_fee - rider - vendor, so it absorbs
-- every timing forfeit (late rider difference, missed vendor cooking bonus). The resolver reads
-- the order's slot target instant (service_date + slot delivery_time, interpreted in the campus
-- timezone), decides on-time-ready and on-time-delivered against it, computes the three shares
-- from mode + timing + point flag, asserts they balance, and persists them together with the
-- ready_on_time / delivered_on_time flags.

-- v2: the internal delivery-fee split (platform/fulfiller/rider/vendor shares) is resolved at the
-- delivered transition by resolve_order_delivery_shares, so it is intentionally no longer part of
-- the post-payment financial snapshot. What the customer paid (food_subtotal, delivery_fee,
-- discount, total, currency) and the order_number stay immutable after payment. This drops ONLY
-- the platform_delivery_share_kobo and fulfiller_delivery_share_kobo checks from the body defined
-- in 20260612000400_orders_payments_batches_settlements.sql; everything else is identical. The
-- trigger itself already points at this function, so it is not re-created.
create or replace function public.protect_order_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.order_status <> 'pending_payment' then
      raise exception 'paid or operational orders cannot be deleted' using errcode = '23000';
    end if;
    return old;
  end if;

  if new.order_number <> old.order_number then
    raise exception 'order_number is immutable' using errcode = '23000';
  end if;

  if old.order_status <> 'pending_payment'
     and (
       new.food_subtotal_kobo <> old.food_subtotal_kobo
       or new.delivery_fee_kobo <> old.delivery_fee_kobo
       or new.discount_kobo <> old.discount_kobo
       or new.total_kobo <> old.total_kobo
       or new.currency <> old.currency
     ) then
    raise exception 'financial snapshots cannot change after payment' using errcode = '23000';
  end if;

  return new;
end;
$$;

comment on function public.protect_order_financial_history() is 'Protects order number and paid-order customer-facing financial snapshots (food_subtotal, delivery_fee, discount, total, currency) from mutation. The internal delivery-fee split shares are resolved at delivery and are intentionally not covered.';

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
  select ord.delivery_mode, ord.point_delivery, ord.ready_at, ord.delivered_at,
         ord.rider_confirmed_ready, ord.delivery_fee_kobo, ord.service_date,
         c.timezone as campus_tz, s.delivery_time
  into o
  from public.orders ord
  join public.campuses c on c.id = ord.campus_id
  join public.delivery_slots s on s.id = ord.delivery_slot_id
  where ord.id = p_order_id;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  v_tz := coalesce(o.campus_tz, 'Africa/Lagos');
  v_target := (o.service_date + o.delivery_time) at time zone v_tz;

  v_ready_ok := o.ready_at is not null and o.ready_at <= v_target - make_interval(mins => v_lead);
  v_deliv_ok := o.delivered_at is not null and o.delivered_at <= v_target;

  if o.delivery_mode = 'meal_direct_rider' then
    v_rider := (case when v_deliv_ok then v_rider_on else v_rider_late end)
             + (case when o.point_delivery then v_point else 0 end);
    v_vendor := case when v_ready_ok and o.rider_confirmed_ready is true then v_vendor_on else 0 end;
  else
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
      delivered_on_time = v_deliv_ok
  where id = p_order_id;
end;
$$;

comment on function public.resolve_order_delivery_shares(uuid) is 'Resolves and persists the rider/vendor/platform delivery split from timing, mode and point flag at delivery. Platform is the residual and absorbs all forfeits.';

-- ---------------------------------------------------------------------------------------------
-- Call the resolver from the 'delivered' transition. transition_order_status is re-created
-- VERBATIM from 20260728000300_ready_at_and_pickup_confirm.sql (the current 7-arg definition);
-- the ONLY change is the perform-block added immediately before `return p_to_status;`. Same
-- signature, so this is a plain create or replace with no drop.
--
-- The resolver reads delivered_at, which this function's own update sets to now() earlier in the
-- same call, so ordering is correct.

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_actor_user_id uuid default auth.uid(),
  p_reason text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_food_was_ready boolean default true
)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_status public.order_status;
begin
  select order_status into v_from_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
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
    (v_from_status = 'delivered' and p_to_status in ('confirmed', 'administratively_completed', 'refunded')) or
    (v_from_status = 'confirmed' and p_to_status = 'refunded') or
    (v_from_status = 'administratively_completed' and p_to_status = 'refunded')
  ) then
    raise exception 'invalid order status transition from % to %', v_from_status, p_to_status using errcode = '23514';
  end if;

  update public.orders
  set order_status = p_to_status,
      accepted_at = case when p_to_status = 'accepted' then now() else accepted_at end,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      confirmed_at = case when p_to_status in ('confirmed', 'administratively_completed') then now() else confirmed_at end,
      cancelled_at = case when p_to_status in ('cancelled', 'expired') then now() else cancelled_at end,
      cancellation_reason = case when p_to_status in ('cancelled', 'expired') then p_reason else cancellation_reason end,
      ready_at = case when p_to_status = 'ready' then now() else ready_at end,
      rider_confirmed_ready = case when p_to_status = 'out_for_delivery' then p_food_was_ready else rider_confirmed_ready end
  where id = p_order_id;

  insert into public.order_status_history (
    order_id,
    from_status,
    to_status,
    actor_user_id,
    reason,
    request_id,
    metadata
  )
  values (
    p_order_id,
    v_from_status,
    p_to_status,
    p_actor_user_id,
    p_reason,
    p_request_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'order.' || p_to_status::text,
    'order',
    p_order_id,
    jsonb_build_object('from_status', v_from_status::text, 'to_status', p_to_status::text)
  );

  if p_to_status = 'delivered' then
    perform public.resolve_order_delivery_shares(p_order_id);
  end if;

  return p_to_status;
end;
$$;

comment on function public.transition_order_status(uuid, public.order_status, uuid, text, text, jsonb, boolean) is 'Transitions an order through the allowed status matrix, appends status history, and emits an outbox event for every meaningful state change. Stamps ready_at when moving to ready and records the rider''s pickup confirmation (rider_confirmed_ready) when moving to out_for_delivery. Resolves the rider/vendor/platform delivery split on the delivered transition.';

commit;
