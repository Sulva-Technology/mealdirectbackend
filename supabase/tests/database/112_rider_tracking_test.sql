begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

select has_table('public', 'rider_locations', 'rider_locations exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.rider_locations'::regclass),
  true,
  'rider_locations has RLS enabled'
);

select is(
  has_table_privilege('authenticated', 'public.rider_locations', 'select'),
  false,
  'authenticated clients cannot read rider locations directly'
);

select lives_ok(
  $$update public.campus_locations set latitude = 7.629, longitude = 5.223
    where id = '22111111-1111-1111-1111-111111111111'$$,
  'a campus location accepts a map pin'
);

select throws_ok(
  $$update public.campus_locations set latitude = 7.629, longitude = null
    where id = '22111111-1111-1111-1111-111111111111'$$,
  '23514',
  null,
  'latitude and longitude must be set together'
);

select throws_ok(
  $$update public.vendors set latitude = 91, longitude = 5
    where id = '31111111-1111-1111-1111-111111111111'$$,
  '23514',
  null,
  'latitude must be within -90..90'
);

select throws_ok(
  $$insert into public.rider_locations (rider_id, latitude, longitude, heading_deg, recorded_at)
    values ('32111111-1111-1111-1111-111111111111', 7.62, 5.21, 360, now())$$,
  '23514',
  null,
  'heading must be 0-359'
);

-- Seed rider 3211 is off shift but holds accepted assignment c111 on batch d111.
insert into public.rider_locations (rider_id, latitude, longitude, recorded_at)
values ('32111111-1111-1111-1111-111111111111', 7.62, 5.21, now());

update public.riders set display_name = display_name
where id = '32111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::integer from public.rider_locations
   where rider_id = '32111111-1111-1111-1111-111111111111'),
  1,
  'an off-shift rider mid-delivery keeps sharing'
);

update public.delivery_assignments set status = 'completed', completed_at = now()
where id = 'c1111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::integer from public.rider_locations
   where rider_id = '32111111-1111-1111-1111-111111111111'),
  0,
  'the location is deleted when an off-shift rider finishes the last delivery'
);

update public.riders set available = true where id = '32111111-1111-1111-1111-111111111111';
insert into public.rider_locations (rider_id, latitude, longitude, recorded_at)
values ('32111111-1111-1111-1111-111111111111', 7.62, 5.21, now());

select is(
  (select count(*)::integer from public.rider_locations
   where rider_id = '32111111-1111-1111-1111-111111111111'),
  1,
  'an on-shift rider can share'
);

update public.riders set available = false where id = '32111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::integer from public.rider_locations
   where rider_id = '32111111-1111-1111-1111-111111111111'),
  0,
  'going off shift with nothing to deliver deletes the location'
);

insert into public.rider_locations (rider_id, latitude, longitude, recorded_at)
values ('32111111-1111-1111-1111-111111111111', 7.62, 5.21, now());
update public.riders set status = 'suspended' where id = '32111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::integer from public.rider_locations
   where rider_id = '32111111-1111-1111-1111-111111111111'),
  0,
  'suspending a rider deletes the location'
);

select is(
  has_function_privilege('authenticated', 'public.clear_rider_location_when_off_duty()', 'execute'),
  false,
  'clean-up trigger functions are not callable by clients'
);

select * from finish();

rollback;
