-- Makes menu item 94aa9760 orderable for slot 51111111-…-115.
-- Root cause: the item had no menu_item_slot_availability rows (so
-- available_menu_items excluded it and generate_menu_item_inventory skipped it)
-- and no menu_item_inventory row. This adds both.
--
-- Run with a quantity, e.g.:  psql "$DATABASE_URL" -v qty=50 -v sd=2026-06-25 -f this.sql
\set mi   '94aa9760-24fe-4390-adbf-c3d7be7fa0a6'
\set slot '51111111-1111-1111-1111-111111111115'

begin;

-- 1. Slot availability for all 7 days (mirrors the vendor's all-day availability).
insert into public.menu_item_slot_availability (menu_item_id, delivery_slot_id, day_of_week, available)
select :'mi'::uuid, :'slot'::uuid, dow, true
from generate_series(0, 6) as dow
where not exists (
  select 1 from public.menu_item_slot_availability misa
  where misa.menu_item_id = :'mi'::uuid
    and misa.delivery_slot_id = :'slot'::uuid
    and misa.day_of_week = dow
    and misa.valid_from is null
    and misa.valid_until is null
);

-- 2. Inventory for the service date / slot. :qty is the starting stock.
insert into public.menu_item_inventory (menu_item_id, service_date, delivery_slot_id, quantity_total)
values (:'mi'::uuid, :'sd'::date, :'slot'::uuid, :qty)
on conflict (menu_item_id, service_date, delivery_slot_id)
  do update set quantity_total = excluded.quantity_total;

-- Verify the item is now orderable (remaining > 0 expected).
select 'after' as chk, remaining_quantity
from public.available_menu_items(
  '11111111-1111-1111-1111-111111111111'::uuid, :'sd'::date, :'slot'::uuid)
where menu_item_id = :'mi'::uuid;

commit;
