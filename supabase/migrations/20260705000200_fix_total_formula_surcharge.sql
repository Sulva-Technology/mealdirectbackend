begin;

-- 20260705000100_large_order_surcharge.sql added large_order_surcharge_kobo and folded it into
-- total_kobo, but left orders_total_formula unchanged. Any over-cap opt-in order (surcharge > 0)
-- therefore violated the check:
--   new row for relation "orders" violates check constraint "orders_total_formula"
-- Fold the surcharge into the formula so the persisted total matches the constraint.

alter table public.orders drop constraint orders_total_formula;
alter table public.orders add constraint orders_total_formula check (
  total_kobo = food_subtotal_kobo + delivery_fee_kobo + service_fee_kobo + large_order_surcharge_kobo - discount_kobo
);

commit;
