begin;

-- Demo/staging stock seeding.
--
-- generate_menu_item_inventory() (migration 20260625000100) pre-warms dated slot
-- rows with quantity_total = 0, on the assumption that vendors then set live stock
-- via inventory adjustments. In demo/staging there is no vendor actively setting
-- stock, so every available_menu_items() row computes remaining_quantity = 0 and
-- public.available_menu_items filters it out (`... > 0`). Result: /orders/quote
-- rejects every item ("unavailable for the requested date and slot") and the order
-- service fee never appears.
--
-- This function tops up ONLY pristine pre-warmed rows (no reservations, no sales,
-- no adjustments) to a positive demo quantity. Any row touched by genuine activity
-- is left exactly as-is, so this is safe to run repeatedly and safe alongside any
-- genuine vendor stock management.
create or replace function public.seed_demo_inventory_horizon(
  p_days integer default 14,
  p_quantity integer default 50
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offset integer;
  v_updated integer := 0;
  v_batch integer;
begin
  -- Ensure rows exist for the whole horizon (created at 0 by the generator).
  for v_offset in 0..greatest(p_days, 0) loop
    perform public.generate_menu_item_inventory((current_date + v_offset)::date, null);
  end loop;

  -- Raise pristine zero-stock rows to the demo quantity.
  update public.menu_item_inventory
  set quantity_total = p_quantity,
      version = version + 1
  where service_date between current_date and (current_date + greatest(p_days, 0))
    and active
    and quantity_total = 0
    and quantity_reserved = 0
    and quantity_sold = 0
    and quantity_adjusted = 0;
  get diagnostics v_batch = row_count;
  v_updated := v_batch;

  return v_updated;
end;
$$;

comment on function public.seed_demo_inventory_horizon(integer, integer) is 'Demo/staging only: tops up pristine pre-warmed (zero) dated slot inventory rows over the next p_days to p_quantity units. Leaves any row with reservations, sales, or adjustments untouched. Scheduled nightly via pg_cron.';

-- Keep the demo horizon stocked. Runs after generate-inventory-horizon (00:05).
-- Named schedule upserts by job name, so reruns are idempotent.
select cron.schedule(
  'seed-demo-inventory',
  '10 0 * * *',
  $$ select public.seed_demo_inventory_horizon(14, 50); $$
);

-- Make the current environment orderable immediately.
select public.seed_demo_inventory_horizon(14, 50);

commit;
