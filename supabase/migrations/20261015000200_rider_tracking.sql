begin;

-- Live rider tracking and delivery ETAs. Riders on shift (or mid-delivery) report their
-- position; admins and fleet managers see riders on a map; customers see their rider
-- approach once their order is out for delivery. ETAs are computed by the API from map pins
-- on campus locations (drop-offs) and vendors (pickups).
--
-- Coordinates are WGS84 decimal degrees stored as numeric(9,6) (~0.1 m precision);
-- floating-point types are not allowed in business schema.

alter table public.campus_locations
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add constraint campus_locations_coordinates_pair check ((latitude is null) = (longitude is null)),
  add constraint campus_locations_latitude_range check (latitude between -90 and 90),
  add constraint campus_locations_longitude_range check (longitude between -180 and 180);

comment on column public.campus_locations.latitude is 'Map pin latitude (WGS84). Set with longitude or not at all; used as the drop-off point for ETAs.';
comment on column public.campus_locations.longitude is 'Map pin longitude (WGS84). Set with latitude or not at all.';

alter table public.vendors
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add constraint vendors_coordinates_pair check ((latitude is null) = (longitude is null)),
  add constraint vendors_latitude_range check (latitude between -90 and 90),
  add constraint vendors_longitude_range check (longitude between -180 and 180);

comment on column public.vendors.latitude is 'Pickup point latitude (WGS84). Set with longitude or not at all; used as the pickup stop for ETAs.';
comment on column public.vendors.longitude is 'Pickup point longitude (WGS84). Set with latitude or not at all.';

-- Latest known position per rider. Only the latest fix is kept: no movement history is
-- stored, and the row is removed when the rider goes off shift with nothing to deliver.
create table public.rider_locations (
  rider_id uuid primary key references public.riders(id) on delete cascade,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  accuracy_m integer,
  heading_deg integer,
  speed_mps numeric(6,2),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint rider_locations_latitude_range check (latitude between -90 and 90),
  constraint rider_locations_longitude_range check (longitude between -180 and 180),
  constraint rider_locations_accuracy_non_negative check (accuracy_m is null or accuracy_m >= 0),
  constraint rider_locations_heading_range check (heading_deg is null or heading_deg between 0 and 359),
  constraint rider_locations_speed_non_negative check (speed_mps is null or speed_mps >= 0)
);

comment on table public.rider_locations is 'Latest GPS fix per rider, written by PUT /rider/location while the rider is on shift or has an open delivery. Latest-only by design: no location history is retained.';
comment on column public.rider_locations.recorded_at is 'When the device took the fix. Older fixes never overwrite newer ones.';
comment on column public.rider_locations.received_at is 'When the API stored the fix.';

-- Stop holding a rider's position once they are off shift and have no open delivery.
create or replace function public.clear_rider_location_when_off_duty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.available
    and not exists (
      select 1
      from public.delivery_assignments da
      where da.rider_id = new.id
        and da.status in ('assigned', 'accepted', 'picked_up')
    )
  then
    delete from public.rider_locations where rider_id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.clear_rider_location_when_off_duty() is 'Deletes a rider''s stored location when they go off shift (or are deactivated) with no open delivery assignment.';

create trigger riders_clear_location_off_duty
after update of available, active, status on public.riders
for each row
when (not new.available or not new.active or new.status <> 'verified')
execute function public.clear_rider_location_when_off_duty();

-- Same clean-up when a rider's last open delivery closes while they are already off shift.
create or replace function public.clear_rider_location_after_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rider_id is not null
    and new.status in ('completed', 'cancelled')
    and not exists (
      select 1 from public.riders r where r.id = new.rider_id and r.available
    )
    and not exists (
      select 1
      from public.delivery_assignments da
      where da.rider_id = new.rider_id
        and da.status in ('assigned', 'accepted', 'picked_up')
    )
  then
    delete from public.rider_locations where rider_id = new.rider_id;
  end if;
  return new;
end;
$$;

comment on function public.clear_rider_location_after_assignment() is 'Deletes an off-shift rider''s stored location once their last open delivery assignment completes or is cancelled.';

create trigger delivery_assignments_clear_rider_location
after update of status on public.delivery_assignments
for each row
when (new.status in ('completed', 'cancelled'))
execute function public.clear_rider_location_after_assignment();

alter table public.rider_locations enable row level security;
revoke all on public.rider_locations from anon, authenticated;
revoke all on function public.clear_rider_location_when_off_duty() from public, anon, authenticated;
revoke all on function public.clear_rider_location_after_assignment() from public, anon, authenticated;

commit;
