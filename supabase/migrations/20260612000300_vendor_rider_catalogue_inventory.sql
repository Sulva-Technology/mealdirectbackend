begin;

create type public.vendor_user_role as enum ('owner', 'staff');
create type public.delivery_mode as enum ('vendor_delivery', 'meal_direct_rider');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  legal_name text not null,
  display_name text not null,
  slug text not null,
  description text,
  phone text,
  email extensions.citext,
  logo_url text,
  kitchen_location text,
  status public.vendor_status not null default 'pending',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  active boolean not null default false,
  default_delivery_mode public.delivery_mode not null default 'meal_direct_rider',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint vendors_phone_shape check (phone is null or phone ~ '^[+0-9][0-9 ()-]{6,24}$'),
  constraint vendors_approval_consistent check (
    (status = 'approved' and approved_at is not null) or status <> 'approved'
  ),
  constraint vendors_campus_slug_unique unique (campus_id, slug)
);

comment on table public.vendors is 'Approved and pending campus food vendors.';
comment on column public.vendors.default_delivery_mode is 'Default fulfiller mode for delivery fees; the order stores its own immutable snapshot.';

create index vendors_campus_status_active_idx on public.vendors (campus_id, status, active, display_name);
create trigger vendors_set_updated_at
before update on public.vendors
for each row execute function public.set_updated_at();

create table public.vendor_users (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.vendor_user_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_users_vendor_user_unique unique (vendor_id, user_id)
);

comment on table public.vendor_users is 'Maps Auth profiles to vendor owner and staff access.';

create index vendor_users_user_active_idx on public.vendor_users (user_id, active);
create index vendor_users_vendor_active_idx on public.vendor_users (vendor_id, active);
create trigger vendor_users_set_updated_at
before update on public.vendor_users
for each row execute function public.set_updated_at();

create table public.vendor_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  paystack_recipient_code text,
  bank_name text not null,
  bank_code text,
  masked_account_number text not null,
  account_name text not null,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_payout_accounts_masked_only check (masked_account_number ~ '^\*{4,}[0-9]{2,4}$')
);

comment on table public.vendor_payout_accounts is 'Vendor payout destination snapshots. Full account numbers are never stored.';
comment on column public.vendor_payout_accounts.paystack_recipient_code is 'Paystack transfer recipient code when one has been provisioned.';

create index vendor_payout_accounts_vendor_active_idx on public.vendor_payout_accounts (vendor_id, active);
create trigger vendor_payout_accounts_set_updated_at
before update on public.vendor_payout_accounts
for each row execute function public.set_updated_at();

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  display_name text not null,
  phone text not null,
  status public.rider_status not null default 'pending',
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint riders_phone_shape check (phone ~ '^[+0-9][0-9 ()-]{6,24}$'),
  constraint riders_verified_consistent check (
    (status = 'verified' and verified_at is not null) or status <> 'verified'
  ),
  constraint riders_campus_user_unique unique (campus_id, user_id)
);

comment on table public.riders is 'Meal Direct delivery personnel by campus.';

create index riders_campus_status_active_idx on public.riders (campus_id, status, active, display_name);
create index riders_user_idx on public.riders (user_id);
create trigger riders_set_updated_at
before update on public.riders
for each row execute function public.set_updated_at();

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  name text not null,
  slug text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_categories_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint menu_categories_display_order_non_negative check (display_order >= 0),
  constraint menu_categories_vendor_slug_unique unique (vendor_id, slug)
);

comment on table public.menu_categories is 'Vendor-specific menu grouping used by catalogue screens.';

create index menu_categories_vendor_active_idx on public.menu_categories (vendor_id, active, display_order);
create trigger menu_categories_set_updated_at
before update on public.menu_categories
for each row execute function public.set_updated_at();

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null,
  counts_toward_spoon_limit boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_types_code_format check (code ~ '^[a-z0-9_]+$'),
  constraint unit_types_code_unique unique (code)
);

comment on table public.unit_types is 'Sellable units such as spoon, piece, portion, plate, bottle, and combo.';
comment on column public.unit_types.counts_toward_spoon_limit is 'When true, quantities count toward the three-spoon takeaway package limit.';

create trigger unit_types_set_updated_at
before update on public.unit_types
for each row execute function public.set_updated_at();

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  category_id uuid references public.menu_categories(id) on delete set null,
  unit_type_id uuid not null references public.unit_types(id) on delete restrict,
  name text not null,
  description text,
  image_url text,
  price_kobo integer not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_price_non_negative check (public.non_negative_kobo(price_kobo)),
  constraint menu_items_display_order_non_negative check (display_order >= 0)
);

comment on table public.menu_items is 'Vendor menu items with integer-kobo pricing and unit-type rules.';
comment on column public.menu_items.price_kobo is 'Current catalogue price in kobo; order items store immutable price snapshots.';

create index menu_items_vendor_active_idx on public.menu_items (vendor_id, active, display_order);
create index menu_items_category_idx on public.menu_items (category_id);
create index menu_items_unit_type_idx on public.menu_items (unit_type_id);
create trigger menu_items_set_updated_at
before update on public.menu_items
for each row execute function public.set_updated_at();

create table public.delivery_slots (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  name text not null,
  delivery_time time not null,
  cutoff_minutes integer not null default 60,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_slots_cutoff_positive check (cutoff_minutes > 0),
  constraint delivery_slots_display_order_non_negative check (display_order >= 0),
  constraint delivery_slots_campus_time_unique unique (campus_id, delivery_time)
);

comment on table public.delivery_slots is 'Editable campus delivery time templates. A dated delivery batch is created separately.';
comment on column public.delivery_slots.cutoff_minutes is 'Orders close this many minutes before the local campus delivery time.';

create index delivery_slots_campus_active_idx on public.delivery_slots (campus_id, active, display_order);
create trigger delivery_slots_set_updated_at
before update on public.delivery_slots
for each row execute function public.set_updated_at();

create table public.vendor_slot_availability (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  delivery_slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  day_of_week integer not null,
  available boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_slot_availability_day check (day_of_week between 0 and 6),
  constraint vendor_slot_availability_valid_range check (valid_from is null or valid_until is null or valid_from <= valid_until),
  constraint vendor_slot_availability_unique unique (vendor_id, delivery_slot_id, day_of_week, valid_from, valid_until)
);

comment on table public.vendor_slot_availability is 'Vendor operating availability by day of week and delivery slot.';

create index vendor_slot_availability_lookup_idx on public.vendor_slot_availability (delivery_slot_id, day_of_week, available);
create index vendor_slot_availability_vendor_idx on public.vendor_slot_availability (vendor_id, day_of_week, available);
create trigger vendor_slot_availability_set_updated_at
before update on public.vendor_slot_availability
for each row execute function public.set_updated_at();

create table public.menu_item_slot_availability (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  delivery_slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  day_of_week integer not null,
  available boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_item_slot_availability_day check (day_of_week between 0 and 6),
  constraint menu_item_slot_availability_valid_range check (valid_from is null or valid_until is null or valid_from <= valid_until),
  constraint menu_item_slot_availability_unique unique (menu_item_id, delivery_slot_id, day_of_week, valid_from, valid_until)
);

comment on table public.menu_item_slot_availability is 'Menu item availability that can be narrower than its vendor slot availability.';

create index menu_item_slot_availability_lookup_idx on public.menu_item_slot_availability (delivery_slot_id, day_of_week, available);
create index menu_item_slot_availability_item_idx on public.menu_item_slot_availability (menu_item_id, day_of_week, available);
create trigger menu_item_slot_availability_set_updated_at
before update on public.menu_item_slot_availability
for each row execute function public.set_updated_at();

create table public.menu_item_inventory (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  service_date date not null,
  delivery_slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  quantity_total integer not null,
  quantity_reserved integer not null default 0,
  quantity_sold integer not null default 0,
  quantity_adjusted integer not null default 0,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_item_inventory_unique unique (menu_item_id, service_date, delivery_slot_id),
  constraint menu_item_inventory_non_negative_values check (
    quantity_total >= 0 and quantity_reserved >= 0 and quantity_sold >= 0 and version > 0
  ),
  constraint menu_item_inventory_effective_non_negative check (quantity_total + quantity_adjusted >= 0),
  constraint menu_item_inventory_capacity check (quantity_reserved + quantity_sold <= quantity_total + quantity_adjusted)
);

comment on table public.menu_item_inventory is 'Dated slot inventory with reserved, sold, and adjustment counters.';
comment on column public.menu_item_inventory.version is 'Optimistic visibility version incremented whenever inventory counters change.';

create index menu_item_inventory_date_slot_idx on public.menu_item_inventory (service_date, delivery_slot_id, active);
create index menu_item_inventory_item_date_idx on public.menu_item_inventory (menu_item_id, service_date, delivery_slot_id);
create trigger menu_item_inventory_set_updated_at
before update on public.menu_item_inventory
for each row execute function public.set_updated_at();

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.menu_item_inventory(id) on delete restrict,
  adjustment_quantity integer not null,
  reason text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_non_zero check (adjustment_quantity <> 0),
  constraint inventory_adjustments_reason_not_blank check (length(btrim(reason)) > 0),
  constraint inventory_adjustments_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.inventory_adjustments is 'Append-only inventory adjustment history used when vendors or admins add or remove portions.';

create index inventory_adjustments_inventory_created_idx on public.inventory_adjustments (inventory_id, created_at desc);
create trigger inventory_adjustments_prevent_update
before update or delete on public.inventory_adjustments
for each row execute function public.prevent_update_delete();

create or replace function public.has_vendor_access(p_vendor_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vendor_users vu
    where vu.vendor_id = p_vendor_id
      and vu.user_id = p_user_id
      and vu.active
  )
  or exists (
    select 1
    from public.vendors v
    where v.id = p_vendor_id
      and public.is_campus_admin(v.campus_id, p_user_id)
  );
$$;

comment on function public.has_vendor_access(uuid, uuid) is 'Checks whether a user is attached to a vendor or administers the vendor campus.';

create or replace function public.has_rider_access(p_rider_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.riders r
    where r.id = p_rider_id
      and r.user_id = p_user_id
      and r.active
  )
  or exists (
    select 1
    from public.riders r
    where r.id = p_rider_id
      and public.is_campus_admin(r.campus_id, p_user_id)
  );
$$;

comment on function public.has_rider_access(uuid, uuid) is 'Checks whether a user is the rider or administers the rider campus.';

create or replace function public.effective_ordering_cutoff_at(p_service_date date, p_delivery_slot_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select ((p_service_date::text || ' ' || ds.delivery_time::text)::timestamp at time zone c.timezone)
         - (ds.cutoff_minutes::text || ' minutes')::interval
  from public.delivery_slots ds
  join public.campuses c on c.id = ds.campus_id
  where ds.id = p_delivery_slot_id;
$$;

comment on function public.effective_ordering_cutoff_at(date, uuid) is 'Calculates the UTC cutoff timestamp from campus local service date, slot time, and cutoff minutes.';

create or replace function public.available_vendors(
  p_campus_id uuid,
  p_service_date date,
  p_delivery_slot_id uuid
)
returns table (
  vendor_id uuid,
  display_name text,
  slug text,
  default_delivery_mode public.delivery_mode
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.display_name, v.slug, v.default_delivery_mode
  from public.vendors v
  join public.delivery_slots ds on ds.id = p_delivery_slot_id and ds.campus_id = v.campus_id
  join public.vendor_slot_availability vsa
    on vsa.vendor_id = v.id
   and vsa.delivery_slot_id = ds.id
   and vsa.day_of_week = extract(dow from p_service_date)::integer
   and vsa.available
   and (vsa.valid_from is null or p_service_date >= vsa.valid_from)
   and (vsa.valid_until is null or p_service_date <= vsa.valid_until)
  where v.campus_id = p_campus_id
    and v.status = 'approved'
    and v.active
    and ds.active
    and public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id) > now()
  order by v.display_name;
$$;

comment on function public.available_vendors(uuid, date, uuid) is 'Lists vendors orderable for a campus, date, and slot after applying active, schedule, and cutoff rules.';

create or replace function public.available_menu_items(
  p_campus_id uuid,
  p_service_date date,
  p_delivery_slot_id uuid
)
returns table (
  menu_item_id uuid,
  vendor_id uuid,
  vendor_name text,
  category_id uuid,
  unit_type_id uuid,
  unit_code text,
  name text,
  description text,
  image_url text,
  price_kobo integer,
  remaining_quantity integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mi.id,
    v.id,
    v.display_name,
    mi.category_id,
    ut.id,
    ut.code,
    mi.name,
    mi.description,
    mi.image_url,
    mi.price_kobo,
    (inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold) as remaining_quantity
  from public.available_vendors(p_campus_id, p_service_date, p_delivery_slot_id) av
  join public.vendors v on v.id = av.vendor_id
  join public.menu_items mi on mi.vendor_id = v.id and mi.active
  join public.unit_types ut on ut.id = mi.unit_type_id and ut.active
  join public.menu_item_slot_availability misa
    on misa.menu_item_id = mi.id
   and misa.delivery_slot_id = p_delivery_slot_id
   and misa.day_of_week = extract(dow from p_service_date)::integer
   and misa.available
   and (misa.valid_from is null or p_service_date >= misa.valid_from)
   and (misa.valid_until is null or p_service_date <= misa.valid_until)
  join public.menu_item_inventory inv
    on inv.menu_item_id = mi.id
   and inv.service_date = p_service_date
   and inv.delivery_slot_id = p_delivery_slot_id
   and inv.active
  where inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold > 0
  order by v.display_name, mi.display_order, mi.name;
$$;

comment on function public.available_menu_items(uuid, date, uuid) is 'Lists menu items with remaining dated inventory after vendor, item, slot, date, and cutoff rules.';

create or replace function public.record_inventory_adjustment(
  p_inventory_id uuid,
  p_adjustment_quantity integer,
  p_reason text,
  p_actor_user_id uuid default auth.uid(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adjustment_id uuid;
begin
  if p_adjustment_quantity = 0 then
    raise exception 'inventory adjustment quantity must be non-zero' using errcode = '23514';
  end if;

  perform 1
  from public.menu_item_inventory
  where id = p_inventory_id
  for update;

  if not found then
    raise exception 'inventory % not found', p_inventory_id using errcode = 'P0002';
  end if;

  update public.menu_item_inventory
  set quantity_adjusted = quantity_adjusted + p_adjustment_quantity,
      version = version + 1
  where id = p_inventory_id;

  insert into public.inventory_adjustments (
    inventory_id,
    adjustment_quantity,
    reason,
    actor_user_id,
    metadata
  )
  values (
    p_inventory_id,
    p_adjustment_quantity,
    p_reason,
    p_actor_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_adjustment_id;

  return v_adjustment_id;
end;
$$;

comment on function public.record_inventory_adjustment(uuid, integer, text, uuid, jsonb) is 'Locks an inventory row, adjusts its effective quantity, and records the append-only adjustment event.';

commit;
