begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

select lives_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":3}]'::jsonb,
       'pgtap-three-spoon',
       'hash-three-spoon'
     ) $$,
  'three spoon units are accepted'
);

select throws_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":4}]'::jsonb,
       'pgtap-four-spoon',
       'hash-four-spoon'
     ) $$,
  '23514',
  null::text,
  'four spoon units are rejected'
);

select is(
  (
    select public.create_pending_order_and_reserve_inventory(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '11111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111',
      current_date + 3,
      '51111111-1111-1111-1111-111111111113',
      '22111111-1111-1111-1111-111111111111',
      'meal_direct_rider',
      '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
      'pgtap-idempotent-order',
      'hash-idempotent-order'
    )
  ),
  (
    select public.create_pending_order_and_reserve_inventory(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      '11111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111',
      current_date + 3,
      '51111111-1111-1111-1111-111111111113',
      '22111111-1111-1111-1111-111111111111',
      'meal_direct_rider',
      '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
      'pgtap-idempotent-order',
      'hash-idempotent-order'
    )
  ),
  'duplicate idempotency key returns the same order resource'
);

create temp table _non_takeaway_fee_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 6,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
  'pgtap-non-takeaway-service-fee',
  'hash-non-takeaway-service-fee',
  null,
  null,
  5000
) as order_id;

select is(
  (select service_fee_kobo from public.orders where id = (select order_id from _non_takeaway_fee_order)),
  0,
  'non-takeaway-only order stores zero service fee'
);

create temp table _mixed_takeaway_fee_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 7,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1},{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
  'pgtap-mixed-takeaway-service-fee',
  'hash-mixed-takeaway-service-fee',
  null,
  null,
  5000
) as order_id;

select is(
  (select service_fee_kobo from public.orders where id = (select order_id from _mixed_takeaway_fee_order)),
  5000,
  'mixed order stores one flat service fee'
);

update public.menu_item_inventory
set quantity_total = 1,
    quantity_reserved = 0,
    quantity_sold = 0,
    quantity_adjusted = 0
where menu_item_id = '61111111-1111-1111-1111-111111111112'
  and service_date = current_date + 4
  and delivery_slot_id = '51111111-1111-1111-1111-111111111113';

select lives_ok(
  $test$ do $do$
     declare
       i integer;
     begin
       for i in 1..20 loop
         begin
           perform public.create_pending_order_and_reserve_inventory(
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
             '11111111-1111-1111-1111-111111111111',
             '31111111-1111-1111-1111-111111111111',
             current_date + 4,
             '51111111-1111-1111-1111-111111111113',
             '22111111-1111-1111-1111-111111111111',
             'meal_direct_rider',
             '[{"menu_item_id":"61111111-1111-1111-1111-111111111112","quantity":1}]'::jsonb,
             'pgtap-oversell-' || i,
             'hash-oversell-' || i
           );
         exception
           when others then
             null;
       end;
     end loop;
     end $do$ $test$,
  '20 repeated purchase attempts complete without corrupting inventory'
);

select ok(
  (
    select quantity_reserved + quantity_sold <= quantity_total + quantity_adjusted
    from public.menu_item_inventory
    where menu_item_id = '61111111-1111-1111-1111-111111111112'
      and service_date = current_date + 4
      and delivery_slot_id = '51111111-1111-1111-1111-111111111113'
  ),
  'repeated purchase attempts do not oversell inventory'
);

select is(
  (
    select quantity_reserved + quantity_sold
    from public.menu_item_inventory
    where menu_item_id = '61111111-1111-1111-1111-111111111112'
      and service_date = current_date + 4
      and delivery_slot_id = '51111111-1111-1111-1111-111111111113'
  ),
  1,
  'only one unit is reserved or sold from one available unit'
);

select * from finish();

rollback;
