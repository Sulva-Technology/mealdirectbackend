begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(2);

-- Seed order '81111111-1111-1111-1111-111111111112' is already in 'paid' status from 040_seed_release_test.
-- Transition to 'accepted' to verify outbox emit and notification materialisation.
select public.transition_order_status(
  '81111111-1111-1111-1111-111111111112',
  'accepted'::public.order_status,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
  'pgtap acceptance test'
);

select ok(
  exists (
    select 1 from public.outbox_events
    where aggregate_id = '81111111-1111-1111-1111-111111111112'::uuid
      and event_type = 'order.accepted'
  ),
  'accepting an order emits order.accepted outbox event'
);

select ok(
  exists (
    select 1 from public.notifications
    where aggregate_id = '81111111-1111-1111-1111-111111111112'::uuid
      and event_type = 'order.accepted'
  ),
  'order.accepted materializes an in-app notification'
);

select * from finish();

rollback;
