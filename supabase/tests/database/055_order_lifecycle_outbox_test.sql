begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(2);

-- Seed order '81111111-1111-1111-1111-111111111112' is already in 'paid' status from the seed.
-- v2 collapsed the lifecycle (slice D): from 'paid' the only forward step is the vendor's
-- one-tap 'ready'. Transition there to verify outbox emit and notification materialisation.
select public.transition_order_status(
  '81111111-1111-1111-1111-111111111112',
  'ready'::public.order_status,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
  'pgtap ready test'
);

select ok(
  exists (
    select 1 from public.outbox_events
    where aggregate_id = '81111111-1111-1111-1111-111111111112'::uuid
      and event_type = 'order.ready'
  ),
  'marking an order ready emits order.ready outbox event'
);

select ok(
  exists (
    select 1 from public.notifications
    where aggregate_id = '81111111-1111-1111-1111-111111111112'::uuid
      and event_type = 'order.ready'
  ),
  'order.ready materializes an in-app notification'
);

select * from finish();

rollback;
