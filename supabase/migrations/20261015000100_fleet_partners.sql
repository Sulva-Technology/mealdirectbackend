begin;

-- Fleet partners: third-party delivery companies onboarded onto one campus. A partner's
-- managers (fleet_partner_members) run their own riders through /v1/fleet: riders join with
-- the partner's join code, managers dispatch batches to them, and the partner earns a
-- commission on its riders' delivery shares. Platform admins keep the final say: they
-- create, suspend and re-terms partners and can still verify, suspend or reassign any rider.
create type public.fleet_partner_status as enum ('active', 'suspended', 'deactivated');

comment on type public.fleet_partner_status is 'Lifecycle of a fleet partner. Only active partners can dispatch, accept riders, or have riders auto-dispatched.';

create table public.fleet_partners (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email extensions.citext,
  status public.fleet_partner_status not null default 'active',
  join_code text not null,
  commission_bps integer not null default 0,
  can_dispatch boolean not null default true,
  dispatch_priority integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_partners_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint fleet_partners_contact_phone_shape check (
    contact_phone is null or contact_phone ~ '^[+0-9][0-9 ()-]{6,24}$'
  ),
  constraint fleet_partners_join_code_shape check (join_code ~ '^[A-Z0-9]{6,12}$'),
  constraint fleet_partners_commission_range check (commission_bps between 0 and 10000),
  constraint fleet_partners_dispatch_priority_range check (dispatch_priority between 0 and 100),
  constraint fleet_partners_join_code_unique unique (join_code)
);

comment on table public.fleet_partners is 'Third-party delivery companies that run their own riders on one campus. Managed by platform admins; operated by fleet_partner_members.';
comment on column public.fleet_partners.join_code is 'Short uppercase code a rider enters to join this fleet. Rotatable by admins and fleet managers.';
comment on column public.fleet_partners.commission_bps is 'Partner share of its riders'' delivery earnings in basis points (10000 = 100%). Reporting only: rider payouts still settle per rider.';
comment on column public.fleet_partners.can_dispatch is 'When false, fleet managers can view but not assign batches; platform admins and auto-dispatch still assign.';
comment on column public.fleet_partners.dispatch_priority is 'Auto-dispatch preference (0-100). Riders of higher-priority partners are offered batches before less-loaded riders of lower priority; platform riders count as 0.';

create unique index fleet_partners_campus_name_unique
  on public.fleet_partners (campus_id, lower(btrim(name)));
create index fleet_partners_campus_status_idx on public.fleet_partners (campus_id, status);

create trigger fleet_partners_set_updated_at
before update on public.fleet_partners
for each row execute function public.set_updated_at();

create table public.fleet_partner_members (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'manager',
  active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_partner_members_role_valid check (role in ('owner', 'manager')),
  constraint fleet_partner_members_partner_user_unique unique (fleet_partner_id, user_id)
);

comment on table public.fleet_partner_members is 'Users who manage a fleet partner. Access to /v1/fleet is resolved from active rows here, not from a JWT role.';
comment on column public.fleet_partner_members.role is 'owner or manager. Both can run the fleet; the distinction is informational for the partner.';

create index fleet_partner_members_user_active_idx on public.fleet_partner_members (user_id, active);

create trigger fleet_partner_members_set_updated_at
before update on public.fleet_partner_members
for each row execute function public.set_updated_at();

alter table public.riders
  add column fleet_partner_id uuid references public.fleet_partners(id) on delete restrict;

comment on column public.riders.fleet_partner_id is 'Fleet partner this rider delivers for, or null for a platform rider. Must be a partner on the rider''s campus.';

create index riders_fleet_partner_idx on public.riders (fleet_partner_id)
  where fleet_partner_id is not null;

-- A rider can only belong to a fleet on its own campus. Checked by trigger because the
-- partner's campus lives on another table.
create or replace function public.enforce_rider_fleet_partner_campus()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fleet_partner_id is not null and not exists (
    select 1
    from public.fleet_partners fp
    where fp.id = new.fleet_partner_id
      and fp.campus_id = new.campus_id
  ) then
    raise exception 'Rider and fleet partner must be on the same campus.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.enforce_rider_fleet_partner_campus() is 'Rejects a rider whose fleet partner is on a different campus.';

create trigger riders_fleet_partner_campus
before insert or update of fleet_partner_id, campus_id on public.riders
for each row execute function public.enforce_rider_fleet_partner_campus();

alter table public.delivery_assignments
  add column fleet_partner_id uuid references public.fleet_partners(id) on delete restrict;

comment on column public.delivery_assignments.fleet_partner_id is 'Fleet partner of the assigned rider at assignment time. Snapshotted so commission reporting does not move when a rider later leaves or joins a fleet.';

create index delivery_assignments_fleet_partner_idx on public.delivery_assignments (fleet_partner_id)
  where fleet_partner_id is not null;

create or replace function public.snapshot_assignment_fleet_partner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rider_id is null then
    new.fleet_partner_id := null;
  else
    select r.fleet_partner_id into new.fleet_partner_id
    from public.riders r
    where r.id = new.rider_id;
  end if;
  return new;
end;
$$;

comment on function public.snapshot_assignment_fleet_partner() is 'Copies the assigned rider''s fleet partner onto the delivery assignment whenever the rider is set or changed.';

create trigger delivery_assignments_fleet_partner_snapshot
before insert or update of rider_id on public.delivery_assignments
for each row execute function public.snapshot_assignment_fleet_partner();

-- Auto-dispatch now skips riders whose fleet partner is not active, and offers batches to
-- riders of higher dispatch_priority partners first. With no partners (or every priority at
-- the default 0) the pick is unchanged: least-loaded, then by name.
create or replace function public.assign_available_rider_to_batch(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_rider_id uuid;
  v_assignment_id uuid;
begin
  if exists (select 1 from public.delivery_assignments where batch_id = p_batch_id) then
    return null;
  end if;

  select campus_id into v_campus_id from public.delivery_batches where id = p_batch_id;
  if v_campus_id is null then
    return null;
  end if;

  select r.id into v_rider_id
  from public.riders r
  left join public.fleet_partners fp on fp.id = r.fleet_partner_id
  left join public.delivery_assignments a
    on a.rider_id = r.id and a.status in ('assigned', 'accepted', 'picked_up')
  where r.campus_id = v_campus_id and r.available and r.active and r.status = 'verified'
    and (r.fleet_partner_id is null or fp.status = 'active')
  group by r.id, fp.dispatch_priority
  order by coalesce(fp.dispatch_priority, 0) desc, count(a.id) asc, r.display_name asc
  limit 1;

  if v_rider_id is null then
    return null;
  end if;

  insert into public.delivery_assignments (batch_id, rider_id, status)
  values (p_batch_id, v_rider_id, 'assigned')
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

comment on function public.assign_available_rider_to_batch(uuid) is 'Auto-assigns an available verified active rider on the batch campus to a batch with no existing assignment, preferring higher fleet dispatch_priority then the least-loaded rider; skips riders of inactive fleet partners. Returns the assignment id or null. Idempotent per batch.';

-- Fleet manager dispatch. Validates and assigns atomically under row locks so two managers
-- (or a manager and an admin) cannot race on one batch. Raises FP-class SQLSTATEs that the
-- API maps to HTTP errors: FP404 not found, FP403 not permitted, FP409 batch conflict,
-- FP422 rider not dispatchable.
create or replace function public.fleet_assign_batch(
  p_fleet_partner_id uuid,
  p_batch_id uuid,
  p_rider_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner public.fleet_partners%rowtype;
  v_batch public.delivery_batches%rowtype;
  v_rider public.riders%rowtype;
  v_existing public.delivery_assignments%rowtype;
  v_assignment_id uuid;
begin
  select * into v_partner from public.fleet_partners where id = p_fleet_partner_id;
  if not found then
    raise exception 'Fleet partner was not found.' using errcode = 'FP404';
  end if;
  if v_partner.status <> 'active' then
    raise exception 'Fleet partner is not active.' using errcode = 'FP403';
  end if;
  if not v_partner.can_dispatch then
    raise exception 'Dispatch is disabled for this fleet partner.' using errcode = 'FP403';
  end if;

  select * into v_batch from public.delivery_batches where id = p_batch_id for update;
  if not found or v_batch.campus_id <> v_partner.campus_id then
    raise exception 'Batch was not found.' using errcode = 'FP404';
  end if;
  if v_batch.delivery_mode <> 'meal_direct_rider' then
    raise exception 'Batch is delivered by the vendor, not a rider.' using errcode = 'FP409';
  end if;
  if v_batch.status not in ('open', 'closed', 'assigned') then
    raise exception 'Batch can no longer be assigned.' using errcode = 'FP409';
  end if;

  select * into v_rider from public.riders where id = p_rider_id for share;
  if not found or v_rider.fleet_partner_id is distinct from p_fleet_partner_id then
    raise exception 'Rider was not found in this fleet.' using errcode = 'FP404';
  end if;
  if v_rider.status <> 'verified' or not v_rider.active then
    raise exception 'Rider must be verified and active before dispatch.' using errcode = 'FP422';
  end if;

  select * into v_existing from public.delivery_assignments where batch_id = p_batch_id for update;
  if found and v_existing.status <> 'cancelled' then
    if v_existing.status in ('accepted', 'picked_up', 'completed') then
      raise exception 'Batch is already in progress with its rider.' using errcode = 'FP409';
    end if;
    if v_existing.vendor_id is not null
      or v_existing.fleet_partner_id is distinct from p_fleet_partner_id then
      raise exception 'Batch is already assigned outside this fleet.' using errcode = 'FP409';
    end if;
  end if;

  insert into public.delivery_assignments (batch_id, rider_id, vendor_id, assigned_by, status)
  values (p_batch_id, p_rider_id, null, p_actor_user_id, 'assigned')
  on conflict (batch_id) do update set
    rider_id = excluded.rider_id,
    vendor_id = null,
    assigned_by = excluded.assigned_by,
    status = 'assigned',
    assigned_at = now(),
    accepted_at = null,
    picked_up_at = null,
    completed_at = null
  returning id into v_assignment_id;

  update public.delivery_batches
  set status = 'assigned', updated_at = now()
  where id = p_batch_id;

  return v_assignment_id;
end;
$$;

comment on function public.fleet_assign_batch(uuid, uuid, uuid, uuid) is 'Assigns a batch on the partner campus to one of the partner''s verified active riders. Allowed only for an active partner with can_dispatch, and only when the batch is unassigned, cancelled, or still merely assigned within the same fleet. Raises FP404/FP403/FP409/FP422.';

alter table public.fleet_partners enable row level security;
alter table public.fleet_partner_members enable row level security;

revoke all on public.fleet_partners from anon, authenticated;
revoke all on public.fleet_partner_members from anon, authenticated;
revoke all on function public.fleet_assign_batch(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_rider_fleet_partner_campus() from public, anon, authenticated;
revoke all on function public.snapshot_assignment_fleet_partner() from public, anon, authenticated;

commit;
