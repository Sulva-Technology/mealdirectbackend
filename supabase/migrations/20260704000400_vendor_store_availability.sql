begin;

-- Per-vendor storefront availability state driving the vendor portal Open/Close/
-- Pause/Sold-out controls. One row per vendor; absence of a row means the default
-- closed state. cutoff_time is admin-controlled and never written by vendors.
create table public.vendor_store_availability (
  vendor_id uuid primary key references public.vendors(id) on delete cascade,
  accepting_orders boolean not null default false,
  state text not null default 'closed',
  pause_until timestamptz,
  cutoff_time time,
  max_orders_per_day integer,
  unavailable_dates date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_store_availability_state_valid
    check (state in ('open', 'closed', 'paused', 'sold_out_today')),
  constraint vendor_store_availability_max_orders_positive
    check (max_orders_per_day is null or max_orders_per_day > 0)
);

comment on table public.vendor_store_availability is 'Per-vendor storefront availability state (open/closed/paused/sold_out_today) for the vendor portal.';
comment on column public.vendor_store_availability.cutoff_time is 'Admin-controlled daily ordering cutoff; vendors cannot write this field.';
comment on column public.vendor_store_availability.unavailable_dates is 'Specific calendar dates the vendor is unavailable.';

create trigger vendor_store_availability_set_updated_at
before update on public.vendor_store_availability
for each row execute function public.set_updated_at();

-- Only the privileged application role (which bypasses RLS) reads or writes these
-- rows; no anon/authenticated grants or policies are added.
alter table public.vendor_store_availability enable row level security;

commit;
