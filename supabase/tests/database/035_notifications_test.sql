begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

insert into public.outbox_events (id, event_type, aggregate_type, aggregate_id, payload, available_at)
values (
  'fb222222-2222-4222-8222-222222222222',
  'payment.successful',
  'order',
  '81111111-1111-1111-1111-111111111112',
  '{"test":true}'::jsonb,
  now()
);

select isnt_empty(
  $$ select 1
     from public.notifications
     where source_outbox_event_id = 'fb222222-2222-4222-8222-222222222222'
       and recipient_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and link_path = '/orders/81111111-1111-1111-1111-111111111112' $$,
  'payment outbox event creates an order notification for the customer'
);

select isnt_empty(
  $$ select 1
     from public.notification_preferences
     where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
       and in_app_enabled
       and payment_updates $$,
  'notification preferences are created with in-app payment updates enabled'
);

select throws_ok(
  $$ insert into public.notifications (
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
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       'fb222222-2222-4222-8222-222222222222',
       'payment.successful',
       'order',
       '81111111-1111-1111-1111-111111111112',
       'Duplicate',
       'Duplicate body',
       '/orders/81111111-1111-1111-1111-111111111112'
     ) $$,
  '23505',
  null::text,
  'notifications are idempotent per recipient and outbox event'
);

select * from finish();

rollback;
