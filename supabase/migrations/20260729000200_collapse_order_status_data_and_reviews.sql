begin;

-- Slice D data migration + review re-gating (soft-drop; the enum keeps all values).
--
-- 1) Move any live order off the now-unreachable states so nothing is stranded and the customer
--    boundary never observes accepted/preparing/confirmed. confirmed rows already have delivered_at
--    set (delivered -> confirmed was the customer-confirm step), so mapping them to delivered keeps
--    their timeline intact. accepted/preparing rows had not yet been marked ready, so they return to
--    paid and the vendor re-marks ready under the collapsed flow.
update public.orders set order_status = 'paid'
  where order_status in ('accepted', 'preparing');

update public.orders set order_status = 'delivered'
  where order_status = 'confirmed';

-- 2) Re-gate reviews on delivered instead of confirmed. Both gates change together:
--    the enforce_review_eligibility() trigger and the reviews insert RLS policy.
--    Bodies are copied verbatim from their source migrations; the only change is the status set.

-- Trigger function — source: 20260612000400_orders_payments_batches_settlements.sql (~line 1411).
create or replace function public.enforce_review_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.orders o
    where o.id = new.order_id
      and o.customer_id = new.reviewer_id
      and o.order_status in ('delivered', 'administratively_completed')
  ) then
    raise exception 'only delivered or administratively completed orders can be reviewed by their customer' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_review_eligibility() is 'Ensures reviews are created only by the customer after delivery or administrative completion.';

-- Insert RLS policy — source: 20260612000500_rls_privileges_security.sql (~line 522). Renamed from
-- reviews_insert_own_confirmed_order to reflect the delivered gate.
drop policy if exists reviews_insert_own_confirmed_order on public.reviews;

create policy reviews_insert_own_delivered_order
on public.reviews
for insert
to authenticated
with check (
  reviewer_id = auth.uid()
  and exists (
    select 1
    from public.orders o
    where o.id = reviews.order_id
      and o.customer_id = auth.uid()
      and o.order_status in ('delivered', 'administratively_completed')
  )
);

commit;
