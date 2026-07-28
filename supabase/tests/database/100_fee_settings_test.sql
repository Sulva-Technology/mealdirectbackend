begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

select is(public.platform_setting_int('fee_delivery_base_kobo', -1), 30000, 'base fee seeded');
select is(public.platform_setting_int('fee_point_surcharge_kobo', -1), 10000, 'point surcharge seeded');
select is(public.platform_setting_int('share_rider_ontime_kobo', -1), 10000, 'rider on-time seeded');
select is(public.platform_setting_int('share_rider_late_kobo', -1), 5000, 'rider late seeded');
select is(public.platform_setting_int('share_vendor_ontime_kobo', -1), 5000, 'vendor on-time seeded');
select is(public.platform_setting_int('share_point_rider_kobo', -1), 5000, 'point rider seeded');
select is(public.platform_setting_int('vendor_ready_lead_minutes', -1), 10, 'lead minutes seeded');
select is(public.platform_setting_int('missing_key_xyz', 42), 42, 'default fallback still works');

select * from finish();
rollback;
