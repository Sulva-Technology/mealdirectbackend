begin;

-- Two more unit types keyed off the takeaway-fee split introduced in
-- 20260706000100_meal_soup_options_and_unit_type_flags.sql:
--
-- 1. 'snacks' — snack items (chin-chin, puff-puff, etc.). No takeaway fee, no spoon cap,
--    no quantity cap. Anything sold as a snack should never pull the packaging/takeaway fee.
-- 2. 'single' — the no-takeaway sibling of 'single_takeaway'. A single-portion item capped at
--    one per line that does NOT pull the takeaway fee and does NOT consume the three-spoon cap.

insert into public.unit_types (code, display_name, counts_toward_spoon_limit, triggers_takeaway_fee, max_quantity)
values
  ('snacks', 'Snack', false, false, null),
  ('single', 'Single portion', false, false, 1)
on conflict (code) do nothing;

commit;
