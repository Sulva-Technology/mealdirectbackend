begin;

-- Vendor + campus-admin notifications for order lifecycle events.
--
-- The existing public.create_notification_for_outbox_event() trigger materializes
-- notifications for the order's customer only. This adds a SEPARATE trigger that
-- materializes notifications for:
--   * vendor  (all active vendor_users of orders.vendor_id) on payment.successful
--   * admin   (campus_admin of orders.campus_id)           on order.escalation_opened,
--                                                              order.refunded,
--                                                              order.cancelled (post-payment only)
-- The customer path is left completely unchanged. Preference topic-gating reuses
-- public.notification_topic_enabled(), exactly like the customer path:
--   payment.%        -> payment_updates
--   order.escalation_% -> escalation_updates
--   order.%          -> order_updates

create or replace function public.create_role_notifications_for_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_from_status text := new.payload ->> 'from_status';
  v_audience text;
  v_title text;
  v_body text;
  v_link_path text;
  v_recipients uuid[];
  v_recipient uuid;
  v_preferences public.notification_preferences%rowtype;
begin
  if new.aggregate_type <> 'order' then
    return new;
  end if;

  -- Decide audience + copy from the event type. Anything not listed here is a
  -- customer-only event and is ignored by this function.
  if new.event_type = 'payment.successful' then
    v_audience := 'vendor';
    v_title := 'New paid order';
    v_body := 'A customer paid for an order. Start preparing.';
  elsif new.event_type = 'order.escalation_opened' then
    v_audience := 'admin';
    v_title := 'Escalation opened';
    v_body := 'A customer opened an escalation on an order.';
  elsif new.event_type = 'order.refunded' then
    v_audience := 'admin';
    v_title := 'Order refunded';
    v_body := 'An order was refunded.';
  elsif new.event_type = 'order.cancelled' and coalesce(v_from_status, '') <> 'pending_payment' then
    -- Only surface post-payment cancellations to admins; abandoned pending-payment
    -- orders (from_status = pending_payment) are noise.
    v_audience := 'admin';
    v_title := 'Order cancelled';
    v_body := 'A paid order was cancelled.';
  else
    return new;
  end if;

  select * into v_order
  from public.orders
  where id = new.aggregate_id;

  if not found then
    return new;
  end if;

  v_link_path := '/orders/' || new.aggregate_id::text;

  if v_audience = 'vendor' then
    select array_agg(vu.user_id)
    into v_recipients
    from public.vendor_users vu
    where vu.vendor_id = v_order.vendor_id
      and vu.active;
  else
    select array_agg(am.user_id)
    into v_recipients
    from public.admin_memberships am
    where am.campus_id = v_order.campus_id
      and am.role = 'campus_admin'
      and am.active
      and am.revoked_at is null;
  end if;

  if v_recipients is null then
    return new;
  end if;

  foreach v_recipient in array v_recipients
  loop
    insert into public.notification_preferences (user_id)
    values (v_recipient)
    on conflict (user_id) do nothing;

    select * into v_preferences
    from public.notification_preferences
    where user_id = v_recipient;

    if not v_preferences.in_app_enabled
       or not public.notification_topic_enabled(v_preferences, new.event_type) then
      continue;
    end if;

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
      v_recipient,
      new.id,
      new.event_type,
      new.aggregate_type,
      new.aggregate_id,
      v_title,
      v_body,
      v_link_path
    )
    on conflict (recipient_user_id, source_outbox_event_id) where source_outbox_event_id is not null do nothing;
  end loop;

  return new;
end;
$$;

comment on function public.create_role_notifications_for_outbox_event() is 'Materializes vendor and campus-admin notifications from order outbox events, complementing the customer-only create_notification_for_outbox_event(). Reuses notification_topic_enabled for preference gating.';

create trigger outbox_events_create_role_notifications
after insert on public.outbox_events
for each row execute function public.create_role_notifications_for_outbox_event();

commit;
