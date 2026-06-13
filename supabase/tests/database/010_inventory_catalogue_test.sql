begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

select throws_ok(
  $$ insert into public.menu_item_inventory (
       menu_item_id,
       service_date,
       delivery_slot_id,
       quantity_total,
       quantity_reserved,
       quantity_sold
     )
     values (
       '61111111-1111-1111-1111-111111111111',
       current_date + 1,
       '51111111-1111-1111-1111-111111111113',
       10,
       0,
       0
     ) $$,
  '23505',
  null::text,
  'duplicate inventory per item/date/slot is rejected'
);

select throws_ok(
  $$ insert into public.menu_item_inventory (
       menu_item_id,
       service_date,
       delivery_slot_id,
       quantity_total
     )
     values (
       '61111111-1111-1111-1111-111111111111',
       current_date + 10,
       '51111111-1111-1111-1111-111111111113',
       -1
     ) $$,
  '23514',
  null::text,
  'negative inventory is rejected'
);

select throws_ok(
  $$ insert into public.menu_item_inventory (
       menu_item_id,
       service_date,
       delivery_slot_id,
       quantity_total,
       quantity_reserved,
       quantity_sold
     )
     values (
       '61111111-1111-1111-1111-111111111111',
       current_date + 11,
       '51111111-1111-1111-1111-111111111113',
       2,
       2,
       1
     ) $$,
  '23514',
  null::text,
  'reserved plus sold cannot exceed effective quantity'
);

select is(
  (
    select remaining_quantity
    from public.available_menu_items(
      '11111111-1111-1111-1111-111111111111',
      current_date + 1,
      '51111111-1111-1111-1111-111111111113'
    )
    where menu_item_id = '61111111-1111-1111-1111-111111111111'
  ),
  15,
  'available_menu_items reports seeded remaining quantity'
);

select isnt_empty(
  $$ select vendor_id
     from public.available_vendors(
       '11111111-1111-1111-1111-111111111111',
       current_date + 1,
       '51111111-1111-1111-1111-111111111113'
     )
     where vendor_id = '31111111-1111-1111-1111-111111111111' $$,
  'vendor availability includes all-day vendor for noon slot'
);

select is_empty(
  $$ select vendor_id
     from public.available_vendors(
       '11111111-1111-1111-1111-111111111111',
       current_date + 1,
       '51111111-1111-1111-1111-111111111116'
     )
     where vendor_id = '31111111-1111-1111-1111-111111111112' $$,
  'morning-only vendor is excluded from night slot'
);

select ok(
  public.effective_ordering_cutoff_at(current_date + 1, '51111111-1111-1111-1111-111111111113')
  =
  (((current_date + 1)::text || ' 12:00:00')::timestamp at time zone 'Africa/Lagos') - interval '60 minutes',
  '60-minute cutoff is calculated in campus timezone'
);

select lives_ok(
  $$ select public.record_inventory_adjustment(
       '71111111-1111-1111-1111-111111111111',
       5,
       'test increase',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
       '{"source":"pgtap"}'::jsonb
     ) $$,
  'inventory adjustments can increase quantity through the audit function'
);

select throws_ok(
  $$ update public.inventory_adjustments
     set reason = 'edited'
     where inventory_id = '71111111-1111-1111-1111-111111111111' $$,
  '23000',
  null::text,
  'inventory adjustment history is append-only'
);

select ok(
  (
    select counts_toward_spoon_limit
    from public.unit_types
    where code = 'spoon'
  ),
  'spoon unit counts toward the three-spoon limit'
);

select * from finish();

rollback;
