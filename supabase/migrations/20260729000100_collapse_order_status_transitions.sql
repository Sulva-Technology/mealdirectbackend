begin;

-- Slice D: collapse the order lifecycle. The vendor's only action becomes paid -> ready
-- (accepted/preparing removed), and delivered is terminal for the happy path (confirmed removed;
-- customers no longer confirm receipt). The order_status enum keeps all values (soft-drop): the
-- three removed states simply become unreachable, and in-flight rows are migrated off them in
-- 20260729000200.
--
-- Body copied verbatim from 20260728000300_ready_at_and_pickup_confirm.sql (the latest prior
-- definition, 7-arg signature with p_food_was_ready). The only changes are:
--   1) the transition matrix (paid -> ready; delivered terminal; accepted/preparing/confirmed rows removed),
--   2) the update block drops the accepted_at stamp and narrows confirmed_at to administratively_completed.
-- Signature is unchanged, so no drop/overload dance is needed here.

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

  return p_to_status;
end;
$$;

comment on function public.transition_order_status(uuid, public.order_status, uuid, text, text, jsonb, boolean) is 'Transitions an order through the collapsed status matrix (paid -> ready; delivered terminal), appends status history, and emits an outbox event for every state change. Stamps ready_at on ready and records the rider''s pickup confirmation (rider_confirmed_ready) on out_for_delivery.';

-- The customer confirm-receipt path is removed: delivered is terminal and reviews now gate on
-- delivered. confirm_delivery only existed to transition delivered -> confirmed (now an invalid
-- transition), so it is dropped. Its Nest endpoint/service/repository wrapper is removed too.
drop function if exists public.confirm_delivery(uuid, uuid, jsonb);

commit;
