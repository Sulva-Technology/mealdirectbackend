begin;

-- Emit outbox event when a rider is assigned to a batch for push/email delivery.
create or replace function public.emit_rider_assignment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.delivery_batches%rowtype;
begin
  if new.rider_id is null then
    return new;
  end if;

  select * into v_batch from public.delivery_batches where id = new.batch_id;
  if not found then
    return new;
  end if;

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'rider.assignment',
    'rider',
    new.rider_id,
    jsonb_build_object(
      'batch_id', new.batch_id::text,
      'assignment_id', new.id::text,
      'order_count', v_batch.order_count,
      'campus_id', v_batch.campus_id::text,
      'vendor_id', v_batch.vendor_id::text
    )
  );

  return new;
end;
$$;

comment on function public.emit_rider_assignment_event() is 'Emit outbox event when a rider is assigned to a batch.';

create trigger delivery_assignments_emit_event
after insert on public.delivery_assignments
for each row
when (new.rider_id is not null)
execute function public.emit_rider_assignment_event();

-- Materialize rider assignment notifications from outbox events.
create or replace function public.create_rider_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider public.riders%rowtype;
  v_batch public.delivery_batches%rowtype;
  v_preferences public.notification_preferences%rowtype;
  v_title text;
  v_body text;
  v_link_path text;
begin
  if new.event_type <> 'rider.assignment' then
    return new;
  end if;

  select * into v_rider from public.riders where id = new.aggregate_id;
  if not found then
    return new;
  end if;

  select * into v_batch from public.delivery_batches where id = (new.payload ->> 'batch_id')::uuid;
  if not found then
    return new;
  end if;

  insert into public.notification_preferences (user_id)
  values (v_rider.user_id)
  on conflict (user_id) do nothing;

  select * into v_preferences
  from public.notification_preferences
  where user_id = v_rider.user_id;

  if not v_preferences.in_app_enabled or not public.notification_topic_enabled(v_preferences, new.event_type) then
    return new;
  end if;

  v_title := 'New assignment';
  v_body := v_batch.order_count || ' order' || case when v_batch.order_count <> 1 then 's' else '' end || ' assigned. Accept to proceed.';
  v_link_path := '/pickup_queue';

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
    v_rider.user_id,
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

comment on function public.create_rider_assignment_notification() is 'Materialize rider assignment notifications from outbox events.';

create trigger create_rider_assignment_notification_trigger
after insert on public.outbox_events
for each row
when (new.event_type = 'rider.assignment')
execute function public.create_rider_assignment_notification();

commit;
