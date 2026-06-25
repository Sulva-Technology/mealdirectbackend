begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

-- Far-out dates avoid the seeded current_date + 1..7 inventory window.
select is_empty(
  $$ select id
     from public.menu_item_inventory
     where service_date = current_date + 30 $$,
  'no inventory exists before generation runs'
);

select cmp_ok(
  public.generate_menu_item_inventory(current_date + 30),
  '>',
  0,
  'generation inserts rows for an empty service date'
);

select isnt_empty(
  $$ select id
     from public.menu_item_inventory
     where menu_item_id = '61111111-1111-1111-1111-111111111111'
       and delivery_slot_id = '51111111-1111-1111-1111-111111111113'
       and service_date = current_date + 30 $$,
  'generation materializes an eligible item/slot row'
);

select is(
  (
    select quantity_total
    from public.menu_item_inventory
    where menu_item_id = '61111111-1111-1111-1111-111111111111'
      and delivery_slot_id = '51111111-1111-1111-1111-111111111113'
      and service_date = current_date + 30
  ),
  0,
  'a freshly generated row starts at a zero total'
);

select is(
  public.generate_menu_item_inventory(current_date + 30),
  0,
  'rerunning generation for the same date is idempotent'
);

-- Vendor-scoped generation only touches the named vendor.
select public.generate_menu_item_inventory(current_date + 31, '31111111-1111-1111-1111-111111111112');

select is_empty(
  $$ select inv.id
     from public.menu_item_inventory inv
     join public.menu_items mi on mi.id = inv.menu_item_id
     where inv.service_date = current_date + 31
       and mi.vendor_id <> '31111111-1111-1111-1111-111111111112' $$,
  'vendor-scoped generation leaves other vendors untouched'
);

select isnt_empty(
  $$ select inv.id
     from public.menu_item_inventory inv
     join public.menu_items mi on mi.id = inv.menu_item_id
     where inv.service_date = current_date + 31
       and mi.vendor_id = '31111111-1111-1111-1111-111111111112' $$,
  'vendor-scoped generation creates rows for the requested vendor'
);

select * from finish();

rollback;
