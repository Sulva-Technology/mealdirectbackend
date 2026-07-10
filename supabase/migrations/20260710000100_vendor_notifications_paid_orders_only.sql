begin;

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

  if v_audience = 'vendor'
     and (v_order.paid_at is null or v_order.order_status in ('pending_payment', 'expired')) then
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
    select array_agg(distinct am.user_id)
    into v_recipients
    from public.admin_memberships am
    where am.active
      and am.revoked_at is null
      and (
        (am.role = 'campus_admin' and am.campus_id = v_order.campus_id)
        or am.role = 'super_admin'
      );
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

comment on function public.create_role_notifications_for_outbox_event() is 'Materializes vendor, campus-admin and super-admin notifications from order outbox events. Vendor notifications are emitted only for orders with confirmed payment.';

commit;
