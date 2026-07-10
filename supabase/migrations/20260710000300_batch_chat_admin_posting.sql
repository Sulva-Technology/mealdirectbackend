begin;

-- ============================================================================
-- Let admins post into a batch chat as "Support". Admin is added as a hidden
-- participant (kept out of the roster) so the existing stamp trigger accepts the
-- message; admin messages fan out to every rider + customer on the batch.
-- ============================================================================

-- 1) Allow the 'admin' role/sender value ------------------------------------
alter table public.batch_chat_participants
  drop constraint batch_chat_participants_role_check;
alter table public.batch_chat_participants
  add constraint batch_chat_participants_role_check
  check (role in ('rider', 'customer', 'vendor', 'admin'));

alter table public.batch_messages
  drop constraint batch_messages_sender_role_check;
alter table public.batch_messages
  add constraint batch_messages_sender_role_check
  check (sender_role in ('rider', 'customer', 'vendor', 'admin'));

-- 2) Label admins as "Support" when added as participants -------------------
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
  elsif p_role = 'admin' then
    v_label := 'Support';
  else
    v_label := 'Vendor';
  end if;

  insert into public.batch_chat_participants (batch_id, user_id, role, label, hidden)
  values (p_batch_id, p_user_id, p_role, v_label, p_hidden)
  on conflict (batch_id, user_id) do nothing;
end;
$$;

comment on function public.upsert_batch_chat_participant(uuid, uuid, text, boolean) is 'Adds a batch chat participant with a computed pseudonym label; no-op if already present. Admins are labelled "Support".';

-- 3) Fan out admin messages to every rider + customer -----------------------
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
        or (v_sender_role = 'admin' and p.role in ('rider', 'customer'))
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

comment on function public.create_batch_chat_notifications() is 'Materialises batch_chat.message outbox events into per-recipient notifications. Fan-out: rider->customers, customer->rider, admin->all rider+customers.';

commit;
