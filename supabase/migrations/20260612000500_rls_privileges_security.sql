begin;

create unique index vendor_slot_availability_unique_effective
on public.vendor_slot_availability (vendor_id, delivery_slot_id, day_of_week, valid_from, valid_until)
nulls not distinct;

create unique index menu_item_slot_availability_unique_effective
on public.menu_item_slot_availability (menu_item_id, delivery_slot_id, day_of_week, valid_from, valid_until)
nulls not distinct;

comment on index public.vendor_slot_availability_unique_effective is 'Prevents duplicate vendor slot rules, treating open-ended date ranges as equal.';
comment on index public.menu_item_slot_availability_unique_effective is 'Prevents duplicate menu item slot rules, treating open-ended date ranges as equal.';

create or replace function public.is_assigned_rider_for_batch(p_batch_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.delivery_assignments da
    join public.riders r on r.id = da.rider_id
    where da.batch_id = p_batch_id
      and r.user_id = p_user_id
      and r.active
      and da.status in ('assigned', 'accepted', 'picked_up', 'completed')
  );
$$;

comment on function public.is_assigned_rider_for_batch(uuid, uuid) is 'Checks whether the current user is the Meal Direct rider assigned to a delivery batch.';

create or replace function public.can_read_delivery_batch(p_batch_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.delivery_batches db
    where db.id = p_batch_id
      and (
        public.is_campus_admin(db.campus_id, p_user_id)
        or public.has_vendor_access(db.vendor_id, p_user_id)
        or public.is_assigned_rider_for_batch(db.id, p_user_id)
      )
  );
$$;

comment on function public.can_read_delivery_batch(uuid, uuid) is 'Checks whether a user can read a batch through campus admin, vendor, or rider assignment scope.';

create or replace function public.can_read_order(p_order_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        o.customer_id = p_user_id
        or public.is_campus_admin(o.campus_id, p_user_id)
        or public.has_vendor_access(o.vendor_id, p_user_id)
        or exists (
          select 1
          from public.delivery_batch_orders dbo
          join public.delivery_assignments da on da.batch_id = dbo.batch_id
          join public.riders r on r.id = da.rider_id
          where dbo.order_id = o.id
            and r.user_id = p_user_id
            and r.active
        )
      )
  );
$$;

comment on function public.can_read_order(uuid, uuid) is 'Checks customer, campus admin, vendor, and assigned rider visibility for one order.';

create or replace function public.can_read_settlement(p_settlement_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.settlements s
    left join public.riders r on r.id = s.rider_id
    where s.id = p_settlement_id
      and (
        public.is_campus_admin(s.campus_id, p_user_id)
        or (s.vendor_id is not null and public.has_vendor_access(s.vendor_id, p_user_id))
        or (s.rider_id is not null and r.user_id = p_user_id)
      )
  );
$$;

comment on function public.can_read_settlement(uuid, uuid) is 'Checks settlement visibility for campus admins, vendor members, and beneficiary riders.';

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

revoke all on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

grant select on public.campuses,
  public.campus_zones,
  public.campus_locations,
  public.vendors,
  public.menu_categories,
  public.unit_types,
  public.menu_items,
  public.delivery_slots
to anon, authenticated;

grant select on public.profiles,
  public.campus_memberships,
  public.admin_memberships,
  public.vendor_users,
  public.riders,
  public.vendor_slot_availability,
  public.menu_item_slot_availability,
  public.menu_item_inventory,
  public.inventory_adjustments,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.delivery_batches,
  public.delivery_batch_orders,
  public.delivery_assignments,
  public.settlements,
  public.settlement_lines,
  public.delivery_confirmations,
  public.escalations,
  public.reviews,
  public.audit_logs,
  public.payment_events,
  public.refunds
to authenticated;

grant insert, update, delete on public.admin_memberships to authenticated;
grant insert on public.reviews to authenticated;
grant update on public.reviews to authenticated;

grant execute on function public.current_user_id() to anon, authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.is_campus_admin(uuid, uuid) to authenticated;
grant execute on function public.has_vendor_access(uuid, uuid) to authenticated;
grant execute on function public.has_rider_access(uuid, uuid) to authenticated;
grant execute on function public.is_assigned_rider_for_batch(uuid, uuid) to authenticated;
grant execute on function public.can_read_delivery_batch(uuid, uuid) to authenticated;
grant execute on function public.can_read_order(uuid, uuid) to authenticated;
grant execute on function public.can_read_settlement(uuid, uuid) to authenticated;
grant execute on function public.effective_ordering_cutoff_at(date, uuid) to anon, authenticated;
grant execute on function public.available_vendors(uuid, date, uuid) to anon, authenticated;
grant execute on function public.available_menu_items(uuid, date, uuid) to anon, authenticated;
grant execute on function public.calculate_delivery_earnings(integer) to anon, authenticated;

create policy campuses_read_active_or_admin
on public.campuses
for select
to authenticated
using (active or public.is_campus_admin(id));

create policy campuses_anon_read_active
on public.campuses
for select
to anon
using (active);

create policy campus_zones_read_active_or_admin
on public.campus_zones
for select
to authenticated
using (active or public.is_campus_admin(campus_id));

create policy campus_zones_anon_read_active
on public.campus_zones
for select
to anon
using (active);

create policy campus_locations_read_active_or_admin
on public.campus_locations
for select
to authenticated
using (active or public.is_campus_admin(campus_id));

create policy campus_locations_anon_read_active
on public.campus_locations
for select
to anon
using (active);

create policy profiles_read_scoped
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_super_admin(auth.uid())
  or exists (
    select 1
    from public.campus_memberships cm
    where cm.user_id = profiles.id
      and public.is_campus_admin(cm.campus_id, auth.uid())
  )
);

create policy campus_memberships_read_scoped
on public.campus_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_campus_admin(campus_id, auth.uid())
);

create policy admin_memberships_read_scoped
on public.admin_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin(auth.uid())
  or (campus_id is not null and public.is_campus_admin(campus_id, auth.uid()))
);

create policy admin_memberships_super_admin_insert
on public.admin_memberships
for insert
to authenticated
with check (public.is_super_admin(auth.uid()));

create policy admin_memberships_super_admin_update
on public.admin_memberships
for update
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

create policy admin_memberships_super_admin_delete
on public.admin_memberships
for delete
to authenticated
using (public.is_super_admin(auth.uid()));

create policy vendors_read_active_or_scoped
on public.vendors
for select
to authenticated
using (
  (active and status = 'approved')
  or public.has_vendor_access(id)
  or public.is_campus_admin(campus_id)
);

create policy vendors_anon_read_active
on public.vendors
for select
to anon
using (active and status = 'approved');

create policy vendor_users_read_scoped
on public.vendor_users
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_vendor_access(vendor_id, auth.uid())
);

create policy riders_read_scoped
on public.riders
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_campus_admin(campus_id, auth.uid())
);

create policy menu_categories_read_active_or_scoped
on public.menu_categories
for select
to authenticated
using (
  active
  and exists (
    select 1
    from public.vendors v
    where v.id = menu_categories.vendor_id
      and v.active
      and v.status = 'approved'
  )
  or public.has_vendor_access(vendor_id)
);

create policy menu_categories_anon_read_active
on public.menu_categories
for select
to anon
using (
  active
  and exists (
    select 1
    from public.vendors v
    where v.id = menu_categories.vendor_id
      and v.active
      and v.status = 'approved'
  )
);

create policy unit_types_read_active
on public.unit_types
for select
to authenticated
using (active or public.is_super_admin(auth.uid()));

create policy unit_types_anon_read_active
on public.unit_types
for select
to anon
using (active);

create policy menu_items_read_active_or_scoped
on public.menu_items
for select
to authenticated
using (
  (
    active
    and exists (
      select 1
      from public.vendors v
      where v.id = menu_items.vendor_id
        and v.active
        and v.status = 'approved'
    )
  )
  or public.has_vendor_access(vendor_id)
);

create policy menu_items_anon_read_active
on public.menu_items
for select
to anon
using (
  active
  and exists (
    select 1
    from public.vendors v
    where v.id = menu_items.vendor_id
      and v.active
      and v.status = 'approved'
  )
);

create policy delivery_slots_read_active_or_admin
on public.delivery_slots
for select
to authenticated
using (active or public.is_campus_admin(campus_id));

create policy delivery_slots_anon_read_active
on public.delivery_slots
for select
to anon
using (active);

create policy vendor_slot_availability_read_vendor_or_admin
on public.vendor_slot_availability
for select
to authenticated
using (
  public.has_vendor_access(vendor_id)
  or exists (
    select 1
    from public.vendors v
    where v.id = vendor_slot_availability.vendor_id
      and public.is_campus_admin(v.campus_id)
  )
);

create policy menu_item_slot_availability_read_vendor_or_admin
on public.menu_item_slot_availability
for select
to authenticated
using (
  exists (
    select 1
    from public.menu_items mi
    where mi.id = menu_item_slot_availability.menu_item_id
      and public.has_vendor_access(mi.vendor_id)
  )
);

create policy menu_item_inventory_read_vendor_or_admin
on public.menu_item_inventory
for select
to authenticated
using (
  exists (
    select 1
    from public.menu_items mi
    where mi.id = menu_item_inventory.menu_item_id
      and public.has_vendor_access(mi.vendor_id)
  )
);

create policy inventory_adjustments_read_vendor_or_admin
on public.inventory_adjustments
for select
to authenticated
using (
  exists (
    select 1
    from public.menu_item_inventory inv
    join public.menu_items mi on mi.id = inv.menu_item_id
    where inv.id = inventory_adjustments.inventory_id
      and public.has_vendor_access(mi.vendor_id)
  )
);

create policy orders_read_scoped
on public.orders
for select
to authenticated
using (public.can_read_order(id, auth.uid()));

create policy order_items_read_scoped
on public.order_items
for select
to authenticated
using (public.can_read_order(order_id, auth.uid()));

create policy order_status_history_read_scoped
on public.order_status_history
for select
to authenticated
using (public.can_read_order(order_id, auth.uid()));

create policy delivery_batches_read_scoped
on public.delivery_batches
for select
to authenticated
using (public.can_read_delivery_batch(id, auth.uid()));

create policy delivery_batch_orders_read_scoped
on public.delivery_batch_orders
for select
to authenticated
using (public.can_read_delivery_batch(batch_id, auth.uid()));

create policy delivery_assignments_read_scoped
on public.delivery_assignments
for select
to authenticated
using (public.can_read_delivery_batch(batch_id, auth.uid()));

create policy settlements_read_scoped
on public.settlements
for select
to authenticated
using (public.can_read_settlement(id, auth.uid()));

create policy settlement_lines_read_scoped
on public.settlement_lines
for select
to authenticated
using (public.can_read_settlement(settlement_id, auth.uid()));

create policy delivery_confirmations_read_customer_or_order_scope
on public.delivery_confirmations
for select
to authenticated
using (
  customer_id = auth.uid()
  or public.can_read_order(order_id, auth.uid())
);

create policy escalations_read_scoped
on public.escalations
for select
to authenticated
using (
  opened_by = auth.uid()
  or public.can_read_order(order_id, auth.uid())
);

create policy reviews_read_scoped
on public.reviews
for select
to authenticated
using (
  reviewer_id = auth.uid()
  or public.can_read_order(order_id, auth.uid())
  or (vendor_id is not null and public.has_vendor_access(vendor_id))
);

create policy reviews_insert_own_confirmed_order
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
      and o.order_status in ('confirmed', 'administratively_completed')
  )
);

create policy reviews_update_own_pending_review
on public.reviews
for update
to authenticated
using (reviewer_id = auth.uid() and moderation_status = 'pending')
with check (reviewer_id = auth.uid());

create policy audit_logs_read_admin_scope
on public.audit_logs
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or (campus_id is not null and public.is_campus_admin(campus_id, auth.uid()))
);

create policy payment_events_super_admin_read
on public.payment_events
for select
to authenticated
using (public.is_super_admin(auth.uid()));

create policy refunds_admin_read
on public.refunds
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or exists (
    select 1
    from public.orders o
    where o.id = refunds.order_id
      and public.is_campus_admin(o.campus_id, auth.uid())
  )
);

comment on policy orders_read_scoped on public.orders is 'Customers see own orders; vendors see own vendor orders; riders see assigned batch orders; admins see campus orders.';
comment on policy admin_memberships_super_admin_insert on public.admin_memberships is 'Only an active Super Admin may create administrative role grants.';
comment on policy menu_item_inventory_read_vendor_or_admin on public.menu_item_inventory is 'Inventory is visible only to the owning vendor or campus administrators, not cross-vendor users.';
comment on policy inventory_adjustments_read_vendor_or_admin on public.inventory_adjustments is 'Inventory adjustment history is readable by the owning vendor and campus administrators through vendor access checks.';

commit;
