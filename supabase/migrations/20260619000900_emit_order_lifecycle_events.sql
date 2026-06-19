begin;

-- 1) Re-create transition_order_status with outbox emit on every meaningful status change.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_actor_user_id uuid default auth.uid(),
  p_reason text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
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
      cancellation_reason = case when p_to_status in ('cancelled', 'expired') then p_reason else cancellation_reason end
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

comment on function public.transition_order_status(uuid, public.order_status, uuid, text, text, jsonb) is 'Transitions an order through the allowed status matrix, appends status history, and emits an outbox event for every meaningful state change.';

-- 2) Re-create create_notification_for_outbox_event with extended case coverage for all lifecycle statuses.
create or replace function public.create_notification_for_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_user_id uuid;
  v_preferences public.notification_preferences%rowtype;
  v_title text;
  v_body text;
  v_link_path text;
begin
  if new.aggregate_type <> 'order' then
    return new;
  end if;

  select customer_id into v_recipient_user_id
  from public.orders
  where id = new.aggregate_id;

  if v_recipient_user_id is null then
    return new;
  end if;

  insert into public.notification_preferences (user_id)
  values (v_recipient_user_id)
  on conflict (user_id) do nothing;

  select * into v_preferences
  from public.notification_preferences
  where user_id = v_recipient_user_id;

  if not v_preferences.in_app_enabled or not public.notification_topic_enabled(v_preferences, new.event_type) then
    return new;
  end if;

  v_title := case new.event_type
    when 'order.pending_payment_created' then 'Order created'
    when 'payment.successful' then 'Payment received'
    when 'order.accepted' then 'Order accepted'
    when 'order.preparing' then 'Order is being prepared'
    when 'order.ready' then 'Order ready'
    when 'order.out_for_delivery' then 'Out for delivery'
    when 'order.delivered' then 'Delivered'
    when 'order.confirmed' then 'Delivery confirmed'
    when 'order.cancelled' then 'Order cancelled'
    when 'order.refunded' then 'Order refunded'
    when 'order.escalation_opened' then 'Escalation opened'
    else null
  end;

  v_body := case new.event_type
    when 'order.pending_payment_created' then 'Your order is waiting for payment.'
    when 'payment.successful' then 'Your payment was verified successfully.'
    when 'order.accepted' then 'The vendor accepted your order.'
    when 'order.preparing' then 'The vendor is preparing your order.'
    when 'order.ready' then 'Your order is ready for pickup by a rider.'
    when 'order.out_for_delivery' then 'Your rider is on the way.'
    when 'order.delivered' then 'Your order was delivered.'
    when 'order.confirmed' then 'Thanks for confirming your delivery.'
    when 'order.cancelled' then 'Your order was cancelled.'
    when 'order.refunded' then 'Your order was refunded.'
    when 'order.escalation_opened' then 'Your issue was sent to the campus admin team.'
    else null
  end;

  if v_title is null or v_body is null then
    return new;
  end if;

  v_link_path := '/orders/' || new.aggregate_id::text;

  insert into public.notifications (
    recipient_user_id,
    source_outbox_event_id,
    event_type,
    aggregate_type,
    aggregate_id,
    title,
    body,
    link_path
  )
  values (
    v_recipient_user_id,
    new.id,
    new.event_type,
    new.aggregate_type,
    new.aggregate_id,
    v_title,
    v_body,
    v_link_path
  )
  on conflict (recipient_user_id, source_outbox_event_id) where source_outbox_event_id is not null do nothing;

  return new;
end;
$$;

comment on function public.create_notification_for_outbox_event() is 'Materializes supported order-related outbox events into user-facing notifications, covering the full order lifecycle.';

commit;
