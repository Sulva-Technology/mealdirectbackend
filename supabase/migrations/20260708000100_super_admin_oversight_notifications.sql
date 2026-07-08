begin;

-- Super Admin visibility, two parts:
--
--   A) Order-lifecycle admin notifications (escalation opened / refunded /
--      post-payment cancelled) currently reach only the campus_admin of the
--      order's campus. Super admins are global (campus_id is null) and were
--      therefore excluded. Extend the admin recipient set to also include every
--      active super_admin, for ALL campuses.
--
--   B) Oversight feed: whenever a NON-super admin (campus_admin, finance_admin,
--      etc.) performs an audited action, notify every active super_admin. This
--      is materialized by an AFTER INSERT trigger on public.audit_logs. The
--      notification logic is wrapped so that any failure can never roll back the
--      audit row itself (the audit trail is authoritative and must survive).

-- ---------------------------------------------------------------------------
-- Part A: include super admins in the order-event admin audience.
-- ---------------------------------------------------------------------------

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

  v_link_path := '/orders/' || new.aggregate_id::text;

  if v_audience = 'vendor' then
    select array_agg(vu.user_id)
    into v_recipients
    from public.vendor_users vu
    where vu.vendor_id = v_order.vendor_id
      and vu.active;
  else
    -- Campus admins scoped to the order's campus PLUS all global super admins.
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

comment on function public.create_role_notifications_for_outbox_event() is 'Materializes vendor, campus-admin AND super-admin notifications from order outbox events. Super admins are global (campus_id null) so they receive the admin audience for every campus.';

-- ---------------------------------------------------------------------------
-- Part B: super-admin oversight feed of sub-admin actions.
-- ---------------------------------------------------------------------------

create or replace function public.notify_super_admins_of_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_is_super boolean;
  v_recipients uuid[];
  v_recipient uuid;
  v_preferences public.notification_preferences%rowtype;
  v_title text;
  v_body text;
  v_link_path text;
begin
  -- Only mirror privileged admin actions with a known actor.
  if new.actor_type <> 'admin' or new.actor_user_id is null then
    return new;
  end if;

  -- Anything below must never roll back the audit_logs insert. The audit trail
  -- is authoritative; a failed oversight notification is acceptable, a lost
  -- audit row is not.
  begin
    -- Super admins acting themselves are not "sub-admin activity" and already
    -- have full visibility; skip to avoid self/peer notification noise.
    select exists (
      select 1
      from public.admin_memberships am
      where am.user_id = new.actor_user_id
        and am.role = 'super_admin'
        and am.active
        and am.revoked_at is null
    ) into v_actor_is_super;

    if v_actor_is_super then
      return new;
    end if;

    select array_agg(distinct am.user_id)
    into v_recipients
    from public.admin_memberships am
    where am.role = 'super_admin'
      and am.active
      and am.revoked_at is null
      and am.user_id <> new.actor_user_id;

    if v_recipients is null then
      return new;
    end if;

    v_title := 'Admin action';
    v_body := 'A campus admin performed: ' || new.action
              || ' on ' || new.entity_type
              || coalesce(' (' || new.entity_id::text || ')', '');
    v_link_path := '/admin/audit-logs/' || new.id::text;

    foreach v_recipient in array v_recipients
    loop
      insert into public.notification_preferences (user_id)
      values (v_recipient)
      on conflict (user_id) do nothing;

      select * into v_preferences
      from public.notification_preferences
      where user_id = v_recipient;

      if not v_preferences.in_app_enabled then
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
        null,
        'admin.' || new.action,
        'audit_log',
        new.id,
        v_title,
        v_body,
        v_link_path
      );
    end loop;
  exception when others then
    -- Swallow: never let oversight-notification failures lose the audit row.
    return new;
  end;

  return new;
end;
$$;

comment on function public.notify_super_admins_of_admin_action() is 'Materializes super-admin oversight notifications from audit_logs rows written by non-super admins. Notification failures are swallowed so the append-only audit row always survives.';

create trigger audit_logs_notify_super_admins
after insert on public.audit_logs
for each row execute function public.notify_super_admins_of_admin_action();

commit;
