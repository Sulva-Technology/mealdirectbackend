begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select has_column('public', 'campus_zones', 'delivery_fee_kobo', 'campus_zones has a delivery_fee_kobo column');

-- Give Zone A a distinct fee, then place an order delivered to a Zone A location.
update public.campus_zones
set delivery_fee_kobo = 25000
where id = '21111111-1111-1111-1111-111111111111';

create temp table _zone_fee_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 5,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
  'pgtap-zone-fee',
  'hash-zone-fee'
) as order_id;

select is(
  (select delivery_fee_kobo from public.orders where id = (select order_id from _zone_fee_order)),
  25000,
  'order delivery_fee_kobo equals the zone fee'
);

select is(
  (select total_kobo - food_subtotal_kobo from public.orders where id = (select order_id from _zone_fee_order)),
  25000,
  'order total includes the zone delivery fee'
);

select * from finish();

rollback;
