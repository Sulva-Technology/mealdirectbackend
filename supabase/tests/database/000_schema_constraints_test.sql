begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'campuses', 'campuses table exists');
select has_table('public', 'vendors', 'vendors table exists');
select has_table('public', 'menu_item_inventory', 'menu_item_inventory table exists');
select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'payments', 'payments table exists');
select has_table('public', 'delivery_batches', 'delivery_batches table exists');
select has_table('public', 'settlements', 'settlements table exists');
select has_table('public', 'outbox_events', 'outbox_events table exists');
select has_table('public', 'notifications', 'notifications table exists');
select has_table('public', 'notification_preferences', 'notification_preferences table exists');

select has_fk('public', 'profiles', 'profiles references auth.users');
select col_type_is('public', 'orders', 'created_at', 'timestamp with time zone', 'orders.created_at uses timestamptz');
select col_type_is('public', 'payments', 'expected_amount_kobo', 'integer', 'payments store kobo as integer');

select throws_ok(
  $$ insert into public.campus_locations (campus_id, zone_id, name, slug, type)
     values ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'Invalid Park', 'invalid-park', 'park'::public.location_type) $$,
  '22P02',
  null::text,
  'invalid location types are rejected'
);

select throws_ok(
  $$ insert into public.campus_zones (campus_id, name, code)
     values ('11111111-1111-1111-1111-111111111111', 'Duplicate Zone A', 'ZONE_A') $$,
  '23505',
  null::text,
  'duplicate zone codes are rejected per campus'
);

select throws_ok(
  $$ insert into public.admin_memberships (user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'campus_admin') $$,
  '23514',
  null::text,
  'campus admin requires a campus'
);

select lives_ok(
  $$ insert into public.admin_memberships (user_id, role, active, revoked_at)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'super_admin', false, now()) $$,
  'super admin can be global'
);

select * from finish();

rollback;
