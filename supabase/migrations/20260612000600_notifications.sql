begin;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default false,
  email_enabled boolean not null default false,
  order_updates boolean not null default true,
  payment_updates boolean not null default true,
  delivery_updates boolean not null default true,
  escalation_updates boolean not null default true,
  settlement_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is 'Per-user channel and topic preferences for Meal Direct notifications.';

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  source_outbox_event_id uuid references public.outbox_events(id) on delete set null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  title text not null,
  body text not null,
  link_path text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_event_type_not_blank check (length(btrim(event_type)) > 0),
  constraint notifications_aggregate_type_not_blank check (length(btrim(aggregate_type)) > 0),
  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_body_not_blank check (length(btrim(body)) > 0),
  constraint notifications_link_path_shape check (link_path is null or link_path ~ '^/[A-Za-z0-9/_?=&.-]*$')
);

comment on table public.notifications is 'User-facing in-app notifications materialized from transactional outbox events.';
comment on column public.notifications.source_outbox_event_id is 'Outbox event that produced the notification, when generated asynchronously or by trigger.';

create unique index notifications_recipient_source_unique
on public.notifications (recipient_user_id, source_outbox_event_id)
where source_outbox_event_id is not null;

create index notifications_recipient_created_idx
on public.notifications (recipient_user_id, created_at desc, id desc);

create index notifications_recipient_unread_idx
on public.notifications (recipient_user_id, read_at, created_at desc);

create index notifications_aggregate_idx
on public.notifications (aggregate_type, aggregate_id);

create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

create or replace function public.notification_topic_enabled(
  p_preferences public.notification_preferences,
  p_event_type text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_event_type like 'payment.%' then (p_preferences).payment_updates
    when p_event_type like 'delivery.%' then (p_preferences).delivery_updates
    when p_event_type like 'order.escalation_%' then (p_preferences).escalation_updates
    when p_event_type like 'settlement.%' then (p_preferences).settlement_updates
    when p_event_type like 'order.%' then (p_preferences).order_updates
    else true
  end;
$$;

comment on function public.notification_topic_enabled(public.notification_preferences, text) is 'Checks whether an outbox event topic is enabled for a user.';

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
    when 'order.escalation_opened' then 'Escalation opened'
    else null
  end;

  v_body := case new.event_type
    when 'order.pending_payment_created' then 'Your order is waiting for payment.'
    when 'payment.successful' then 'Your payment was verified successfully.'
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

comment on function public.create_notification_for_outbox_event() is 'Materializes supported order-related outbox events into user-facing notifications.';

create trigger outbox_events_create_notification
after insert on public.outbox_events
for each row execute function public.create_notification_for_outbox_event();

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

grant select, insert, update on public.notification_preferences to authenticated;
grant select, update on public.notifications to authenticated;
grant execute on function public.notification_topic_enabled(public.notification_preferences, text) to authenticated;

create policy notification_preferences_read_own
on public.notification_preferences
for select
to authenticated
using (user_id = auth.uid());

create policy notification_preferences_insert_own
on public.notification_preferences
for insert
to authenticated
with check (user_id = auth.uid());

create policy notification_preferences_update_own
on public.notification_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy notifications_read_own
on public.notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

create policy notifications_update_own
on public.notifications
for update
to authenticated
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

commit;
