begin;

-- Materializes dated slot inventory from vendor and menu-item availability rules.
-- Idempotent: existing rows keep their vendor-edited quantities, only missing
-- (vendor, item, slot, date) combinations are inserted with a zero starting total.
create or replace function public.generate_menu_item_inventory(
  p_service_date date,
  p_vendor_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow integer := extract(dow from p_service_date)::integer;
  v_inserted integer;
begin
  insert into public.menu_item_inventory (
    menu_item_id,
    service_date,
    delivery_slot_id,
    quantity_total
  )
  select distinct mi.id, p_service_date, ds.id, 0
  from public.menu_items mi
  join public.menu_item_slot_availability misa
    on misa.menu_item_id = mi.id
   and misa.available
   and misa.day_of_week = v_dow
   and (misa.valid_from is null or p_service_date >= misa.valid_from)
   and (misa.valid_until is null or p_service_date <= misa.valid_until)
  join public.delivery_slots ds
    on ds.id = misa.delivery_slot_id
   and ds.active
  join public.vendor_slot_availability vsa
    on vsa.vendor_id = mi.vendor_id
   and vsa.delivery_slot_id = ds.id
   and vsa.available
   and vsa.day_of_week = v_dow
   and (vsa.valid_from is null or p_service_date >= vsa.valid_from)
   and (vsa.valid_until is null or p_service_date <= vsa.valid_until)
  where mi.active
    and (p_vendor_id is null or mi.vendor_id = p_vendor_id)
  on conflict (menu_item_id, service_date, delivery_slot_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.generate_menu_item_inventory(date, uuid) is 'Inserts missing dated slot inventory rows for a service date (optionally one vendor) from active menu items and matching menu-item and vendor slot availability; leaves existing rows untouched.';

-- Pre-warms inventory for the next p_days days across all vendors so customers
-- always see stock without waiting for a lazy generation on first read.
create or replace function public.generate_inventory_horizon(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_offset integer;
begin
  for v_offset in 0..greatest(p_days, 0) loop
    v_total := v_total + public.generate_menu_item_inventory((current_date + v_offset)::date, null);
  end loop;
  return v_total;
end;
$$;

comment on function public.generate_inventory_horizon(integer) is 'Runs generate_menu_item_inventory for today through today + p_days across all vendors. Scheduled via pg_cron nightly.';

-- Named schedule upserts by job name, so reruns are idempotent.
select cron.schedule(
  'generate-inventory-horizon',
  '5 0 * * *',
  $$ select public.generate_inventory_horizon(7); $$
);

commit;
