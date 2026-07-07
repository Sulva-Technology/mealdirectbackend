begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- Fixtures: a shared soup list for the seeded vendor (one active, one inactive) and a
-- menu item flagged requires_soup. Item 6111...111 (Jollof) already has inventory across
-- the horizon for slot 5111...113.
insert into public.vendor_soup_options (id, vendor_id, name, active, display_order)
values
  ('5a111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'Egusi', true, 1),
  ('5a111111-1111-1111-1111-111111111112', '31111111-1111-1111-1111-111111111111', 'Ogbono', false, 2);

update public.menu_items
set requires_soup = true
where id = '61111111-1111-1111-1111-111111111111';

-- 1. A required soup that is not supplied is rejected.
select throws_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1}]'::jsonb,
       'pgtap-soup-missing',
       'hash-soup-missing'
     ) $$,
  '23514',
  null::text,
  'a required soup selection that is missing is rejected'
);

-- 2. A soup id that does not belong to the vendor is rejected.
select throws_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1,"soup_option_id":"5a111111-1111-1111-1111-1111111111ff"}]'::jsonb,
       'pgtap-soup-unknown',
       'hash-soup-unknown'
     ) $$,
  '23514',
  null::text,
  'an unknown soup selection is rejected'
);

-- 3. An inactive soup is rejected.
select throws_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 2,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1,"soup_option_id":"5a111111-1111-1111-1111-111111111112"}]'::jsonb,
       'pgtap-soup-inactive',
       'hash-soup-inactive'
     ) $$,
  '23514',
  null::text,
  'an inactive soup selection is rejected'
);

-- 4 + 5. A valid, active, vendor-owned soup is accepted and persisted on the order line.
create temp table _soup_order on commit drop as
select public.create_pending_order_and_reserve_inventory(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '11111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  current_date + 2,
  '51111111-1111-1111-1111-111111111113',
  '22111111-1111-1111-1111-111111111111',
  'meal_direct_rider',
  '[{"menu_item_id":"61111111-1111-1111-1111-111111111111","quantity":1,"soup_option_id":"5a111111-1111-1111-1111-111111111111"}]'::jsonb,
  'pgtap-soup-valid',
  'hash-soup-valid'
) as order_id;

select isnt(
  (select order_id from _soup_order),
  null,
  'a valid soup selection creates the order'
);

select is(
  (select soup_option_id from public.order_items where order_id = (select order_id from _soup_order)),
  '5a111111-1111-1111-1111-111111111111'::uuid,
  'the chosen soup is persisted on the order line'
);

-- 6 + 7. A unit type with max_quantity caps the per-line quantity.
update public.unit_types set max_quantity = 1 where code = 'bottle';

select throws_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 3,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":2}]'::jsonb,
       'pgtap-maxqty-over',
       'hash-maxqty-over'
     ) $$,
  '23514',
  null::text,
  'a quantity above the unit type max_quantity is rejected'
);

select lives_ok(
  $$ select public.create_pending_order_and_reserve_inventory(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
       '11111111-1111-1111-1111-111111111111',
       '31111111-1111-1111-1111-111111111111',
       current_date + 3,
       '51111111-1111-1111-1111-111111111113',
       '22111111-1111-1111-1111-111111111111',
       'meal_direct_rider',
       '[{"menu_item_id":"61111111-1111-1111-1111-111111111113","quantity":1}]'::jsonb,
       'pgtap-maxqty-at',
       'hash-maxqty-at'
     ) $$,
  'a quantity at the unit type max_quantity is accepted'
);

-- 8. The single-portion + takeaway unit type is seeded with the split flags.
select is(
  (
    select (counts_toward_spoon_limit, triggers_takeaway_fee, max_quantity)::text
    from public.unit_types
    where code = 'single_takeaway'
  ),
  (false, true, 1)::text,
  'the single_takeaway unit type charges the fee, skips the spoon cap, and caps at one'
);

select * from finish();

rollback;
