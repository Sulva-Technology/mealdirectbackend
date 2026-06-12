begin;

create type public.account_status as enum ('active', 'suspended', 'deactivated');
create type public.admin_role as enum ('super_admin', 'campus_admin');
create type public.location_type as enum ('hostel', 'department');
create type public.actor_type as enum ('customer', 'vendor', 'rider', 'admin', 'system');
create type public.vendor_status as enum ('pending', 'approved', 'suspended', 'deactivated');
create type public.rider_status as enum ('pending', 'verified', 'suspended', 'deactivated');

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  timezone text not null default 'Africa/Lagos',
  currency char(3) not null default 'NGN',
  country_code char(2) not null default 'NG',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campuses_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint campuses_currency_uppercase check (currency = upper(currency)),
  constraint campuses_country_code_uppercase check (country_code = upper(country_code)),
  constraint campuses_slug_unique unique (slug)
);

comment on table public.campuses is 'Campuses where Meal Direct operates; Venite University is the pilot campus.';
comment on column public.campuses.timezone is 'IANA timezone used to calculate delivery cutoffs from local campus times.';

create trigger campuses_set_updated_at
before update on public.campuses
for each row execute function public.set_updated_at();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text,
  email extensions.citext,
  phone_number text,
  avatar_url text,
  account_status public.account_status not null default 'active',
  default_campus_id uuid references public.campuses(id) on delete set null,
  default_location_id uuid,
  onboarding_completed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_number_shape check (phone_number is null or phone_number ~ '^[+0-9][0-9 ()-]{6,24}$')
);

comment on table public.profiles is 'Application profile for every Supabase Auth user. The id matches auth.users.id.';
comment on column public.profiles.email is 'Snapshot of the Auth email for operational display; Auth remains the source of identity truth.';
comment on column public.profiles.account_status is 'Soft account lifecycle state used instead of deleting user operational history.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table public.campus_zones (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  name text not null,
  code text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campus_zones_code_format check (code ~ '^[A-Z0-9_]+$'),
  constraint campus_zones_display_order_non_negative check (display_order >= 0),
  constraint campus_zones_campus_code_unique unique (campus_id, code)
);

comment on table public.campus_zones is 'Delivery zones within a campus, such as Zone A and Zone B.';

create index campus_zones_campus_active_idx on public.campus_zones (campus_id, active, display_order);

create trigger campus_zones_set_updated_at
before update on public.campus_zones
for each row execute function public.set_updated_at();

create table public.campus_locations (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  zone_id uuid not null references public.campus_zones(id) on delete restrict,
  name text not null,
  slug text not null,
  type public.location_type not null,
  delivery_instructions text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campus_locations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint campus_locations_display_order_non_negative check (display_order >= 0),
  constraint campus_locations_campus_slug_unique unique (campus_id, slug)
);

comment on table public.campus_locations is 'Preset delivery locations for each campus. MVP locations are hostels and departments.';
comment on column public.campus_locations.delivery_instructions is 'Editable instructions shown to customers, vendors, riders, and admins.';

create index campus_locations_campus_zone_active_idx on public.campus_locations (campus_id, zone_id, active, display_order);
create index campus_locations_type_active_idx on public.campus_locations (type, active);

create trigger campus_locations_set_updated_at
before update on public.campus_locations
for each row execute function public.set_updated_at();

alter table public.profiles
  add constraint profiles_default_location_fk
  foreign key (default_location_id) references public.campus_locations(id) on delete set null;

create table public.campus_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  constraint campus_memberships_user_campus_unique unique (user_id, campus_id)
);

comment on table public.campus_memberships is 'Records the campuses a user belongs to without duplicating Auth identity.';

create index campus_memberships_campus_active_idx on public.campus_memberships (campus_id, active);

create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete restrict,
  role public.admin_role not null,
  active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint admin_memberships_role_scope check (
    (role = 'super_admin' and campus_id is null)
    or
    (role = 'campus_admin' and campus_id is not null)
  ),
  constraint admin_memberships_revoked_when_inactive check (
    active = true or revoked_at is not null
  )
);

comment on table public.admin_memberships is 'Administrative role grants. Super Admin is global; Campus Admin is scoped to one campus.';
comment on column public.admin_memberships.granted_by is 'Granting administrator snapshot; never inferred from user-controlled Auth metadata.';

create unique index admin_memberships_super_admin_unique
on public.admin_memberships (user_id)
where role = 'super_admin' and active;

create unique index admin_memberships_campus_admin_unique
on public.admin_memberships (user_id, campus_id)
where role = 'campus_admin' and active;

create index admin_memberships_campus_role_idx on public.admin_memberships (campus_id, role, active);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type public.actor_type not null,
  campus_id uuid references public.campuses(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  ip_address inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_logs_entity_type_not_blank check (length(btrim(entity_type)) > 0),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.audit_logs is 'Append-only audit log for privileged and operational changes.';
comment on column public.audit_logs.ip_address is 'Client IP address captured as inet when available from the API layer.';

create index audit_logs_actor_created_idx on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_campus_created_idx on public.audit_logs (campus_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_request_idx on public.audit_logs (request_id) where request_id is not null;

create trigger audit_logs_prevent_update
before update or delete on public.audit_logs
for each row execute function public.prevent_update_delete();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is 'Creates an application profile for new Auth users without trusting metadata for roles or privileged state.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid();
$$;

comment on function public.current_user_id() is 'Returns the current Supabase Auth user id for policies and application checks.';

create or replace function public.is_super_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_memberships am
    where am.user_id = p_user_id
      and am.role = 'super_admin'
      and am.active
      and am.revoked_at is null
  );
$$;

comment on function public.is_super_admin(uuid) is 'Checks active global Super Admin membership for the supplied user.';

create or replace function public.is_campus_admin(p_campus_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin(p_user_id)
    or exists (
      select 1
      from public.admin_memberships am
      where am.user_id = p_user_id
        and am.campus_id = p_campus_id
        and am.role = 'campus_admin'
        and am.active
        and am.revoked_at is null
    );
$$;

comment on function public.is_campus_admin(uuid, uuid) is 'Checks whether a user can administer a campus, including global Super Admins.';

commit;
