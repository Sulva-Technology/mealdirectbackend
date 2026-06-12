begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

select is(
  (select count(*) from public.campuses where slug = 'venite-university'),
  1::bigint,
  'Venite University is seeded'
);

select is(
  (select count(*) from public.campus_zones where campus_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint,
  'Zone A and Zone B are seeded'
);

select cmp_ok(
  (select count(*) from public.campus_locations where campus_id = '11111111-1111-1111-1111-111111111111'),
  '>=',
  4::bigint,
  'sample hostels and departments are seeded'
);

select is(
  (select count(*) from public.vendors where campus_id = '11111111-1111-1111-1111-111111111111'),
  3::bigint,
  'three fictional vendors are seeded'
);

select is(
  (select count(*) from public.delivery_slots where campus_id = '11111111-1111-1111-1111-111111111111'),
  6::bigint,
  'six suggested delivery slots are seeded'
);

select is(
  (select count(*) from public.unit_types),
  7::bigint,
  'seven MVP unit types are seeded'
);

select cmp_ok(
  (select count(*) from public.menu_item_inventory where service_date between current_date + 1 and current_date + 7),
  '>=',
  20::bigint,
  'inventory is seeded for the next seven days'
);

select isnt_empty(
  $$ select 1 from public.orders where order_status = 'pending_payment' $$,
  'sample pending order is seeded'
);

select isnt_empty(
  $$ select 1 from public.orders where order_status = 'paid' $$,
  'sample paid order is seeded'
);

select isnt_empty(
  $$ select 1 from public.orders where order_status = 'preparing' $$,
  'sample preparing order is seeded'
);

select isnt_empty(
  $$ select 1 from public.orders where order_status = 'delivered' $$,
  'sample delivered order is seeded'
);

select isnt_empty(
  $$ select 1 from public.escalations where status in ('open', 'investigating') $$,
  'sample escalation is seeded'
);

select isnt_empty(
  $$ select 1 from public.refunds where status = 'succeeded' $$,
  'sample refund is seeded'
);

select isnt_empty(
  $$ select 1 from public.reviews where reviewer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' $$,
  'review for confirmed order is seeded'
);

select throws_ok(
  $$ insert into public.reviews (order_id, reviewer_id, vendor_rating)
     values (
       '81111111-1111-1111-1111-111111111112',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       5
     ) $$,
  '23514',
  'unconfirmed orders cannot be reviewed'
);

select is(
  (
    select count(*)
    from public.payment_events
    where event_fingerprint = 'seed-webhook-paid'
  ),
  1::bigint,
  'payment webhook seed is deduplicated'
);

select isnt_empty(
  $$ select 1 from public.delivery_batch_orders where order_id = '81111111-1111-1111-1111-111111111112' $$,
  'paid order is grouped into a delivery batch'
);

select isnt_empty(
  $$ select 1 from public.outbox_events where aggregate_type = 'order' $$,
  'outbox events are seeded for background workers'
);

select * from finish();

rollback;
