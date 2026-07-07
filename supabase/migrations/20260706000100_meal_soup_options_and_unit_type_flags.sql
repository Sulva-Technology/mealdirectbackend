begin;

-- Meal soup options + single-item (pepper-soup) unit type.
--
-- 1. Split the two behaviours that were both keyed on unit_types.counts_toward_spoon_limit:
--      * counts_toward_spoon_limit  -> ONLY the "max 3 spoon units per takeaway" cap (swallows).
--      * triggers_takeaway_fee      -> whether the item pulls the takeaway/service fee.
--    Backfill triggers_takeaway_fee from the existing flag so current swallows are unchanged.
-- 2. Add unit_types.max_quantity: a per-line quantity cap (NULL = unlimited). Pepper soup = 1.
-- 3. Add vendor_soup_options: a shared per-vendor list of labelled soups (no price, no stock).
-- 4. Flag menu items that require a soup pick (menu_items.requires_soup).
-- 5. Record the chosen soup on the order line (order_items.soup_option_id).
-- 6. Seed the single-portion + takeaway unit type used by pepper soup.

alter table public.unit_types
  add column if not exists triggers_takeaway_fee boolean not null default false,
  add column if not exists max_quantity integer
    constraint unit_types_max_quantity_positive check (max_quantity is null or max_quantity >= 1);

-- Preserve current behaviour: every unit that counted toward the spoon limit charged the
-- takeaway fee, so seed the new flag from the old one before they diverge.
update public.unit_types
set triggers_takeaway_fee = counts_toward_spoon_limit
where triggers_takeaway_fee is distinct from counts_toward_spoon_limit;

comment on column public.unit_types.counts_toward_spoon_limit is 'When true, quantities count toward the three-spoon takeaway package limit (swallows).';
comment on column public.unit_types.triggers_takeaway_fee is 'When true, an order containing this item pulls the flat takeaway/service fee. Independent of the spoon-limit cap.';
comment on column public.unit_types.max_quantity is 'Maximum quantity allowed per order line for this unit type; NULL means unlimited. Used for single-portion items like pepper soup.';

create table public.vendor_soup_options (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_soup_options_name_not_blank check (btrim(name) <> ''),
  constraint vendor_soup_options_display_order_non_negative check (display_order >= 0)
);

comment on table public.vendor_soup_options is 'Shared per-vendor list of soups a menu item flagged requires_soup can be served with. Labels only — no price, no inventory.';

-- One soup name per vendor, case-insensitive.
create unique index vendor_soup_options_vendor_name_unique
  on public.vendor_soup_options (vendor_id, lower(name));
create index vendor_soup_options_vendor_active_idx
  on public.vendor_soup_options (vendor_id, active, display_order);

create trigger vendor_soup_options_set_updated_at
before update on public.vendor_soup_options
for each row execute function public.set_updated_at();

alter table public.menu_items
  add column if not exists requires_soup boolean not null default false;

comment on column public.menu_items.requires_soup is 'When true, ordering this item requires the customer to pick exactly one of the vendor''s active soup options.';

alter table public.order_items
  add column if not exists soup_option_id uuid references public.vendor_soup_options(id) on delete restrict;

comment on column public.order_items.soup_option_id is 'The soup chosen for this line when the menu item required one; NULL otherwise.';

-- Seed the single-portion + takeaway unit type (pepper soup and similar): charges the
-- takeaway fee, is capped at one per line, and does NOT consume the three-spoon cap.
insert into public.unit_types (code, display_name, counts_toward_spoon_limit, triggers_takeaway_fee, max_quantity)
values ('single_takeaway', 'Single portion + takeaway', false, true, 1)
on conflict (code) do nothing;

-- RLS + grants: mirror menu_categories so the customer-facing catalogue can read a vendor's
-- active soups while vendor members can read their own (active or not). The backend connects
-- with a privileged role and enforces access in the app layer; these are defence-in-depth.
alter table public.vendor_soup_options enable row level security;

grant select on public.vendor_soup_options to anon, authenticated;

create policy vendor_soup_options_read_active_or_scoped
on public.vendor_soup_options
for select
to authenticated
using (
  active
  and exists (
    select 1
    from public.vendors v
    where v.id = vendor_soup_options.vendor_id
      and v.active
      and v.status = 'approved'
  )
  or public.has_vendor_access(vendor_id)
);

create policy vendor_soup_options_anon_read_active
on public.vendor_soup_options
for select
to anon
using (
  active
  and exists (
    select 1
    from public.vendors v
    where v.id = vendor_soup_options.vendor_id
      and v.active
      and v.status = 'approved'
  )
);

commit;
