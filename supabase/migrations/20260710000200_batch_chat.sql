begin;

-- ============================================================================
-- Batch chat: per-batch group thread. Rider + customers on a batch can post;
-- customers are pseudonymised (Customer N). Reuses the outbox → notifications →
-- dispatch → FCM pipeline for push; Supabase Realtime handles live delivery.
-- ============================================================================

-- 1) Notification preference topic for chat ---------------------------------
alter table public.notification_preferences
  add column if not exists batch_chat_enabled boolean not null default true;

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
    when p_event_type like 'batch_chat.%' then (p_preferences).batch_chat_enabled
    when p_event_type like 'order.%' then (p_preferences).order_updates
    else true
  end;
$$;

comment on function public.notification_topic_enabled(public.notification_preferences, text) is 'Checks whether an outbox event topic is enabled for a user.';

-- 2) Participant + message tables -------------------------------------------
create table public.batch_chat_participants (
  batch_id uuid not null references public.delivery_batches(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null,
  label text not null,
  hidden boolean not null default false,
  joined_at timestamptz not null default now(),
  constraint batch_chat_participants_pk primary key (batch_id, user_id),
  constraint batch_chat_participants_role_check check (role in ('rider', 'customer', 'vendor')),
  constraint batch_chat_participants_label_not_blank check (length(btrim(label)) > 0)
);

comment on table public.batch_chat_participants is 'Membership of a per-batch chat thread. label is the pseudonym snapshot shown to customers (Customer N for customers, display name for rider).';

create index batch_chat_participants_user_idx
  on public.batch_chat_participants (user_id);

create table public.batch_messages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.delivery_batches(id) on delete restrict,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  sender_label text not null,
  sender_role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint batch_messages_sender_role_check check (sender_role in ('rider', 'customer', 'vendor')),
  constraint batch_messages_body_length check (length(btrim(body)) between 1 and 2000)
);

comment on table public.batch_messages is 'Chat messages for a delivery batch. Row carries only an opaque sender id + pseudonym snapshot so it is safe to expose over Supabase Realtime.';

create index batch_messages_batch_created_idx
  on public.batch_messages (batch_id, created_at desc, id desc);

-- 3) Participant helpers -----------------------------------------------------
create or replace function public.is_batch_chat_participant(
  p_batch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.batch_chat_participants
    where batch_id = p_batch_id
      and user_id = p_user_id
  );
$$;

comment on function public.is_batch_chat_participant(uuid, uuid) is 'True when the user is a participant of the batch chat. Security definer so it can back RLS policies.';

-- Insert a participant, computing a stable "Customer N" label for customers.
create or replace function public.upsert_batch_chat_participant(
  p_batch_id uuid,
  p_user_id uuid,
  p_role text,
  p_hidden boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_customer_index integer;
begin
  if exists (
    select 1 from public.batch_chat_participants
    where batch_id = p_batch_id and user_id = p_user_id
  ) then
    return;
  end if;

  if p_role = 'customer' then
    select count(*) + 1 into v_customer_index
    from public.batch_chat_participants
    where batch_id = p_batch_id and role = 'customer';
    v_label := 'Customer ' || v_customer_index::text;
  elsif p_role = 'rider' then
    select display_name into v_label
    from public.riders
    where user_id = p_user_id
    order by created_at desc
    limit 1;
    v_label := coalesce(v_label, 'Rider');
  else
    v_label := 'Vendor';
  end if;

  insert into public.batch_chat_participants (batch_id, user_id, role, label, hidden)
  values (p_batch_id, p_user_id, p_role, v_label, p_hidden)
  on conflict (batch_id, user_id) do nothing;
end;
$$;

comment on function public.upsert_batch_chat_participant(uuid, uuid, text, boolean) is 'Adds a batch chat participant with a computed pseudonym label; no-op if already present.';

-- 4) Auto-add customer when an order joins a batch --------------------------
create or replace function public.batch_chat_add_customer_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id
  from public.orders
  where id = new.order_id;

  if v_customer_id is not null then
    perform public.upsert_batch_chat_participant(new.batch_id, v_customer_id, 'customer', false);
  end if;

  return new;
end;
$$;

create trigger delivery_batch_orders_add_chat_participant
after insert on public.delivery_batch_orders
for each row execute function public.batch_chat_add_customer_on_order();

-- 5) Auto-add rider when an assignment gets a rider -------------------------
create or replace function public.batch_chat_add_rider_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if new.rider_id is null then
    return new;
  end if;

  select user_id into v_user_id
  from public.riders
  where id = new.rider_id;

  if v_user_id is not null then
    perform public.upsert_batch_chat_participant(new.batch_id, v_user_id, 'rider', false);
  end if;

  return new;
end;
$$;

create trigger delivery_assignments_add_chat_participant
after insert or update of rider_id on public.delivery_assignments
for each row execute function public.batch_chat_add_rider_on_assignment();

-- 6) Stamp + guard messages on insert ---------------------------------------
-- Backend inserts via the owner role (bypasses RLS) and passes sender_user_id
-- from the verified JWT. This trigger is the integrity gate: it rejects
-- non-participants and closed batches, and overrides label/role from the
-- participant row so the client cannot spoof its displayed identity.
create or replace function public.batch_chat_stamp_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.batch_chat_participants%rowtype;
  v_status public.batch_status;
begin
  select * into v_participant
  from public.batch_chat_participants
  where batch_id = new.batch_id
    and user_id = new.sender_user_id;

  if not found then
    raise exception 'sender is not a participant of batch %', new.batch_id
      using errcode = '42501';
  end if;

  select status into v_status
  from public.delivery_batches
  where id = new.batch_id;

  if v_status in ('completed', 'cancelled') then
    raise exception 'batch % chat is read-only', new.batch_id
      using errcode = '23514';
  end if;

  new.sender_label := v_participant.label;
  new.sender_role := v_participant.role;

  return new;
end;
$$;

create trigger batch_messages_stamp
before insert on public.batch_messages
for each row execute function public.batch_chat_stamp_message();

-- 7) Emit an outbox event for each message ----------------------------------
create or replace function public.batch_chat_emit_message_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'batch_chat.message',
    'batch_chat',
    new.batch_id,
    jsonb_build_object(
      'message_id', new.id::text,
      'sender_user_id', new.sender_user_id::text,
      'sender_role', new.sender_role
    )
  );
  return new;
end;
$$;

create trigger batch_messages_emit_event
after insert on public.batch_messages
for each row execute function public.batch_chat_emit_message_event();

-- 8) Materialise notifications with asymmetric fan-out ----------------------
-- rider message  -> all customer participants
-- customer message -> rider participant(s) only
-- sender always excluded; hidden participants (vendor) never targeted.
create or replace function public.create_batch_chat_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_sender_user_id uuid;
  v_sender_role text;
  v_sender_label text;
  v_body text;
  v_link_path text;
  v_recipient record;
  v_preferences public.notification_preferences%rowtype;
begin
  if new.aggregate_type <> 'batch_chat' or new.event_type <> 'batch_chat.message' then
    return new;
  end if;

  v_message_id := (new.payload ->> 'message_id')::uuid;
  v_sender_user_id := (new.payload ->> 'sender_user_id')::uuid;
  v_sender_role := new.payload ->> 'sender_role';

  select sender_label, left(body, 140) into v_sender_label, v_body
  from public.batch_messages
  where id = v_message_id;

  if v_sender_label is null then
    return new;
  end if;

  v_link_path := '/batches/' || new.aggregate_id::text || '/chat';

  for v_recipient in
    select p.user_id
    from public.batch_chat_participants p
    where p.batch_id = new.aggregate_id
      and p.hidden = false
      and p.user_id <> v_sender_user_id
      and (
        (v_sender_role = 'rider' and p.role = 'customer')
        or (v_sender_role = 'customer' and p.role = 'rider')
      )
  loop
    insert into public.notification_preferences (user_id)
    values (v_recipient.user_id)
    on conflict (user_id) do nothing;

    select * into v_preferences
    from public.notification_preferences
    where user_id = v_recipient.user_id;

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
      v_recipient.user_id,
      new.id,
      new.event_type,
      new.aggregate_type,
      new.aggregate_id,
      'New message from ' || v_sender_label,
      v_body,
      v_link_path
    )
    on conflict (recipient_user_id, source_outbox_event_id)
      where source_outbox_event_id is not null do nothing;
  end loop;

  return new;
end;
$$;

comment on function public.create_batch_chat_notifications() is 'Materialises batch_chat.message outbox events into per-recipient notifications with asymmetric fan-out (rider->customers, customer->rider).';

create trigger outbox_events_create_batch_chat_notification
after insert on public.outbox_events
for each row execute function public.create_batch_chat_notifications();

-- 9) Backfill participants for existing batches -----------------------------
insert into public.batch_chat_participants (batch_id, user_id, role, label, hidden, joined_at)
select
  dbo.batch_id,
  o.customer_id,
  'customer',
  'Customer ' || row_number() over (
    partition by dbo.batch_id order by dbo.added_at, dbo.id
  )::text,
  false,
  dbo.added_at
from public.delivery_batch_orders dbo
join public.orders o on o.id = dbo.order_id
on conflict (batch_id, user_id) do nothing;

insert into public.batch_chat_participants (batch_id, user_id, role, label, hidden, joined_at)
select
  da.batch_id,
  r.user_id,
  'rider',
  coalesce(r.display_name, 'Rider'),
  false,
  da.assigned_at
from public.delivery_assignments da
join public.riders r on r.id = da.rider_id
where da.rider_id is not null
on conflict (batch_id, user_id) do nothing;

-- 10) RLS + grants (Supabase clients read via Realtime; inserts go through the
--     backend owner role, which bypasses RLS) ------------------------------
alter table public.batch_chat_participants enable row level security;
alter table public.batch_messages enable row level security;

grant select on public.batch_chat_participants to authenticated;
grant select on public.batch_messages to authenticated;
grant execute on function public.is_batch_chat_participant(uuid, uuid) to authenticated;

create policy batch_chat_participants_read
on public.batch_chat_participants
for select
to authenticated
using (public.is_batch_chat_participant(batch_id, auth.uid()));

create policy batch_messages_read
on public.batch_messages
for select
to authenticated
using (public.is_batch_chat_participant(batch_id, auth.uid()));

-- 11) Publish messages to Supabase Realtime ---------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.batch_messages;
  end if;
end;
$$;

commit;
