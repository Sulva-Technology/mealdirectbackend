begin;

-- Fix (final review, slice D regression): the slice-D collapse migration
-- (20260729000100_collapse_order_status_transitions.sql) re-created transition_order_status
-- from the pre-resolver body (20260728000300), which silently dropped the
-- `if p_to_status = 'delivered' then perform resolve_order_delivery_shares(...)` call that
-- slice C added in 20260728000500. Because 0729 sorts after 0728, the resolver call was never
-- restored, so on the `delivered` transition the rider/vendor/platform delivery shares stayed
-- NULL and every settlement/batch-earning read `coalesce(...,0) = 0` — riders and vendors
-- earned nothing and the whole timing-incentive model was dead (and silent, because the
-- resolved-shares balance check only fires once delivered_on_time is non-null).
--
-- This re-creates transition_order_status with the collapsed matrix from 0729 UNCHANGED and the
-- delivered -> resolve_order_delivery_shares call restored (as slice C intended). The resolver
-- reads delivered_at, which the UPDATE below stamps to now() first, so ordering is correct.
-- Signature is unchanged (7-arg with p_food_was_ready), so no drop/overload dance is needed.

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
    (v_from_status = 'paid' and p_to_status in ('ready', 'cancelled', 'refunded')) or
    (v_from_status = 'ready' and p_to_status in ('out_for_delivery', 'cancelled')) or
    (v_from_status = 'out_for_delivery' and p_to_status in ('delivered', 'cancelled')) or
    (v_from_status = 'delivered' and p_to_status in ('administratively_completed', 'refunded')) or
    (v_from_status = 'administratively_completed' and p_to_status = 'refunded')
  ) then
    raise exception 'invalid order status transition from % to %', v_from_status, p_to_status using errcode = '23514';
  end if;

  update public.orders
  set order_status = p_to_status,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      confirmed_at = case when p_to_status = 'administratively_completed' then now() else confirmed_at end,
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

  -- Resolve the rider/vendor/platform delivery split at the moment the order is delivered.
  -- delivered_at was set to now() by the UPDATE above, which resolve_order_delivery_shares reads.
  if p_to_status = 'delivered' then
    perform public.resolve_order_delivery_shares(p_order_id);
  end if;

  return p_to_status;
end;
$$;

comment on function public.transition_order_status(uuid, public.order_status, uuid, text, text, jsonb, boolean) is 'Transitions an order through the collapsed status matrix (paid -> ready; delivered terminal), appends status history, and emits an outbox event for every state change. Stamps ready_at on ready and records the rider''s pickup confirmation (rider_confirmed_ready) on out_for_delivery. Resolves the rider/vendor/platform delivery split on the delivered transition.';

commit;
