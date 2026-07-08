begin;

set search_path = public, extensions;
set constraints all deferred;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'authenticated', 'authenticated', 'customer.one@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Ada Customer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'authenticated', 'authenticated', 'owner.alliday@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Bayo Vendor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'authenticated', 'authenticated', 'rider.one@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Chika Rider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'authenticated', 'authenticated', 'campus.admin@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Dara Campus Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'authenticated', 'authenticated', 'super.admin@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Eno Super Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'authenticated', 'authenticated', 'staff.alliday@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Femi Vendor Staff"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'authenticated', 'authenticated', 'customer.two@example.test', extensions.crypt('local-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Gina Customer"}', now(), now())
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into public.campuses (id, name, slug, timezone, currency, country_code, active)
values
  ('11111111-1111-1111-1111-111111111111', 'Venite University', 'venite-university', 'Africa/Lagos', 'NGN', 'NG', true),
  ('11111111-1111-1111-1111-111111111199', 'Northgate Institute', 'northgate-institute', 'Africa/Lagos', 'NGN', 'NG', true)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug,
    timezone = excluded.timezone,
    active = excluded.active;

insert into public.profiles (id, display_name, email, phone_number, default_campus_id, default_location_id, onboarding_completed_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Ada Customer', 'customer.one@example.test', '+234 800 000 0001', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Bayo Vendor', 'owner.alliday@example.test', '+234 800 000 0002', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Chika Rider', 'rider.one@example.test', '+234 800 000 0003', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'Dara Campus Admin', 'campus.admin@example.test', '+234 800 000 0004', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'Eno Super Admin', 'super.admin@example.test', '+234 800 000 0005', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'Femi Vendor Staff', 'staff.alliday@example.test', '+234 800 000 0006', '11111111-1111-1111-1111-111111111111', null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'Gina Customer', 'customer.two@example.test', '+234 800 000 0007', '11111111-1111-1111-1111-111111111111', null, now())
on conflict (id) do update
set display_name = excluded.display_name,
    email = excluded.email,
    phone_number = excluded.phone_number,
    default_campus_id = excluded.default_campus_id,
    onboarding_completed_at = excluded.onboarding_completed_at;

insert into public.campus_zones (id, campus_id, name, code, display_order)
values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Zone A', 'ZONE_A', 1),
  ('21111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Zone B', 'ZONE_B', 2),
  ('21111111-1111-1111-1111-111111111199', '11111111-1111-1111-1111-111111111199', 'Main Zone', 'MAIN', 1)
on conflict (id) do update
set name = excluded.name,
    code = excluded.code,
    display_order = excluded.display_order;

insert into public.campus_locations (id, campus_id, zone_id, name, slug, type, delivery_instructions, display_order)
values
  ('22111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'Unity Hostel', 'unity-hostel', 'hostel', 'Sample hostel pickup point near the porter desk.', 1),
  ('22111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111112', 'Peace Hostel', 'peace-hostel', 'hostel', 'Sample hostel pickup point beside the common room.', 2),
  ('22111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'Science Department', 'science-department', 'department', 'Sample department drop-off at the foyer.', 3),
  ('22111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111112', 'Administration Department', 'administration-department', 'department', 'Sample department drop-off at the reception desk.', 4),
  ('22111111-1111-1111-1111-111111111199', '11111111-1111-1111-1111-111111111199', '21111111-1111-1111-1111-111111111199', 'Northgate Hall', 'northgate-hall', 'department', 'Cross-campus sample used for authorization tests.', 1)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug,
    type = excluded.type,
    delivery_instructions = excluded.delivery_instructions,
    display_order = excluded.display_order;

update public.profiles
set default_location_id = '22111111-1111-1111-1111-111111111111'
where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7');

insert into public.campus_memberships (user_id, campus_id, active)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', '11111111-1111-1111-1111-111111111111', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', '11111111-1111-1111-1111-111111111111', true)
on conflict (user_id, campus_id) do update
set active = excluded.active;

insert into public.admin_memberships (user_id, campus_id, role, active, granted_by, granted_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', null, 'super_admin', true, null, now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', '11111111-1111-1111-1111-111111111111', 'campus_admin', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', now())
on conflict do nothing;

insert into public.vendors (id, campus_id, legal_name, display_name, slug, description, phone, email, kitchen_location, status, approved_by, approved_at, active, default_delivery_mode)
values
  ('31111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Alliday Cafeteria Limited', 'Alliday Cafeteria', 'alliday-cafeteria', 'Fictional all-day campus cafeteria.', '+234 800 100 0001', 'hello@alliday.example.test', 'Sample Kitchen 1', 'approved', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', now(), true, 'meal_direct_rider'),
  ('31111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Sunrise Bowls Ventures', 'Sunrise Bowls', 'sunrise-bowls', 'Fictional morning-only vendor.', '+234 800 100 0002', 'orders@sunrise.example.test', 'Sample Kitchen 2', 'approved', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', now(), true, 'meal_direct_rider'),
  ('31111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 'Night Plate Foods', 'Night Plate', 'night-plate', 'Fictional afternoon-and-night vendor.', '+234 800 100 0003', 'orders@nightplate.example.test', 'Sample Kitchen 3', 'approved', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', now(), true, 'vendor_delivery'),
  ('31111111-1111-1111-1111-111111111199', '11111111-1111-1111-1111-111111111199', 'Northgate Test Meals', 'Northgate Test Meals', 'northgate-test-meals', 'Cross-campus fictional vendor used for authorization tests.', '+234 800 100 0099', 'orders@northgate.example.test', 'Northgate Sample Kitchen', 'approved', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', now(), true, 'meal_direct_rider')
on conflict (id) do update
set display_name = excluded.display_name,
    status = excluded.status,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    active = excluded.active,
    default_delivery_mode = excluded.default_delivery_mode;

insert into public.vendor_users (vendor_id, user_id, role, active)
values
  ('31111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'owner', true),
  ('31111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'staff', true)
on conflict (vendor_id, user_id) do update
set role = excluded.role,
    active = excluded.active;

insert into public.vendor_payout_accounts (id, vendor_id, paystack_recipient_code, bank_name, bank_code, masked_account_number, account_name, verified_at, active)
values
  ('33111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'RCP_seed_alliday', 'Meal Direct Test Bank', '999', '******1234', 'Alliday Cafeteria Limited', now(), true),
  ('33111111-1111-1111-1111-111111111112', '31111111-1111-1111-1111-111111111112', 'RCP_seed_sunrise', 'Meal Direct Test Bank', '999', '******5678', 'Sunrise Bowls Ventures', now(), true)
on conflict (id) do update
set paystack_recipient_code = excluded.paystack_recipient_code,
    masked_account_number = excluded.masked_account_number,
    active = excluded.active;

insert into public.riders (id, campus_id, user_id, display_name, phone, status, verified_by, verified_at, active)
values ('32111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Chika Rider', '+234 800 200 0001', 'verified', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', now(), true)
on conflict (campus_id, user_id) do update
set display_name = excluded.display_name,
    phone = excluded.phone,
    status = excluded.status,
    active = excluded.active;

insert into public.unit_types (id, code, display_name, counts_toward_spoon_limit, active)
values
  ('41111111-1111-1111-1111-111111111111', 'spoon', 'Spoon', true, true),
  ('41111111-1111-1111-1111-111111111112', 'piece', 'Piece', false, true),
  ('41111111-1111-1111-1111-111111111113', 'portion', 'Portion', false, true),
  ('41111111-1111-1111-1111-111111111114', 'plate', 'Plate', false, true),
  ('41111111-1111-1111-1111-111111111115', 'half_plate', 'Half Plate', false, true),
  ('41111111-1111-1111-1111-111111111116', 'bottle', 'Bottle', false, true),
  ('41111111-1111-1111-1111-111111111117', 'combo', 'Combo', false, true)
on conflict (code) do update
set display_name = excluded.display_name,
    counts_toward_spoon_limit = excluded.counts_toward_spoon_limit,
    active = excluded.active;

-- Fee-split unit types (see 20260707000100_snack_and_single_unit_types.sql). Snacks and the
-- plain single portion never pull the takeaway fee; single is capped at one per line.
insert into public.unit_types (id, code, display_name, counts_toward_spoon_limit, triggers_takeaway_fee, max_quantity, active)
values
  ('41111111-1111-1111-1111-111111111118', 'snacks', 'Snack', false, false, null, true),
  ('41111111-1111-1111-1111-111111111119', 'single', 'Single portion', false, false, 1, true)
on conflict (code) do update
set display_name = excluded.display_name,
    counts_toward_spoon_limit = excluded.counts_toward_spoon_limit,
    triggers_takeaway_fee = excluded.triggers_takeaway_fee,
    max_quantity = excluded.max_quantity,
    active = excluded.active;

insert into public.delivery_slots (id, campus_id, name, delivery_time, cutoff_minutes, active, display_order)
values
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '08:00', '08:00', 60, true, 1),
  ('51111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '10:00', '10:00', 60, true, 2),
  ('51111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', '12:00', '12:00', 60, true, 3),
  ('51111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', '14:00', '14:00', 60, true, 4),
  ('51111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111111', '17:00', '17:00', 60, true, 5),
  ('51111111-1111-1111-1111-111111111116', '11111111-1111-1111-1111-111111111111', '19:00', '19:00', 60, true, 6),
  ('51111111-1111-1111-1111-111111111199', '11111111-1111-1111-1111-111111111199', '12:00', '12:00', 60, true, 1)
on conflict (id) do update
set name = excluded.name,
    delivery_time = excluded.delivery_time,
    cutoff_minutes = excluded.cutoff_minutes,
    active = excluded.active,
    display_order = excluded.display_order;

insert into public.menu_categories (id, vendor_id, name, slug, display_order)
values
  ('34111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'Main Meals', 'main-meals', 1),
  ('34111111-1111-1111-1111-111111111112', '31111111-1111-1111-1111-111111111112', 'Morning Packs', 'morning-packs', 1),
  ('34111111-1111-1111-1111-111111111113', '31111111-1111-1111-1111-111111111113', 'Night Specials', 'night-specials', 1),
  ('34111111-1111-1111-1111-111111111199', '31111111-1111-1111-1111-111111111199', 'Cross Campus Meals', 'cross-campus-meals', 1)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug,
    display_order = excluded.display_order;

insert into public.menu_items (id, vendor_id, category_id, unit_type_id, name, description, price_kobo, active, display_order)
values
  ('61111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', '34111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111', 'Jollof Rice', 'Fictional spoon-priced rice.', 80000, true, 1),
  ('61111111-1111-1111-1111-111111111112', '31111111-1111-1111-1111-111111111111', '34111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111112', 'Grilled Chicken', 'Fictional chicken piece.', 50000, true, 2),
  ('61111111-1111-1111-1111-111111111113', '31111111-1111-1111-1111-111111111111', '34111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111116', 'Table Water', 'Fictional bottled water.', 20000, true, 3),
  ('61111111-1111-1111-1111-111111111121', '31111111-1111-1111-1111-111111111112', '34111111-1111-1111-1111-111111111112', '41111111-1111-1111-1111-111111111117', 'Akara Breakfast Combo', 'Fictional morning combo.', 70000, true, 1),
  ('61111111-1111-1111-1111-111111111122', '31111111-1111-1111-1111-111111111112', '34111111-1111-1111-1111-111111111112', '41111111-1111-1111-1111-111111111113', 'Moi Moi Portion', 'Fictional bean pudding portion.', 60000, true, 2),
  ('61111111-1111-1111-1111-111111111131', '31111111-1111-1111-1111-111111111113', '34111111-1111-1111-1111-111111111113', '41111111-1111-1111-1111-111111111117', 'Shawarma Combo', 'Fictional evening combo.', 150000, true, 1),
  ('61111111-1111-1111-1111-111111111132', '31111111-1111-1111-1111-111111111113', '34111111-1111-1111-1111-111111111113', '41111111-1111-1111-1111-111111111111', 'Fried Rice', 'Fictional spoon-priced fried rice.', 90000, true, 2),
  ('61111111-1111-1111-1111-111111111199', '31111111-1111-1111-1111-111111111199', '34111111-1111-1111-1111-111111111199', '41111111-1111-1111-1111-111111111114', 'Northgate Plate', 'Cross-campus fictional plate.', 100000, true, 1)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    price_kobo = excluded.price_kobo,
    active = excluded.active,
    display_order = excluded.display_order;

insert into public.vendor_slot_availability (vendor_id, delivery_slot_id, day_of_week, available)
select '31111111-1111-1111-1111-111111111111', ds.id, dow, true
from public.delivery_slots ds
cross join generate_series(0, 6) as dow
where ds.campus_id = '11111111-1111-1111-1111-111111111111'
on conflict do nothing;

insert into public.vendor_slot_availability (vendor_id, delivery_slot_id, day_of_week, available)
select '31111111-1111-1111-1111-111111111112', ds.id, dow, true
from public.delivery_slots ds
cross join generate_series(0, 6) as dow
where ds.id in ('51111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111112')
on conflict do nothing;

insert into public.vendor_slot_availability (vendor_id, delivery_slot_id, day_of_week, available)
select '31111111-1111-1111-1111-111111111113', ds.id, dow, true
from public.delivery_slots ds
cross join generate_series(0, 6) as dow
where ds.id in ('51111111-1111-1111-1111-111111111114', '51111111-1111-1111-1111-111111111115', '51111111-1111-1111-1111-111111111116')
on conflict do nothing;

insert into public.menu_item_slot_availability (menu_item_id, delivery_slot_id, day_of_week, available)
select mi.id, vsa.delivery_slot_id, vsa.day_of_week, true
from public.menu_items mi
join public.vendor_slot_availability vsa on vsa.vendor_id = mi.vendor_id
on conflict do nothing;

insert into public.vendor_slot_availability (vendor_id, delivery_slot_id, day_of_week, available)
select '31111111-1111-1111-1111-111111111199', '51111111-1111-1111-1111-111111111199', dow, true
from generate_series(0, 6) as dow
on conflict do nothing;

insert into public.menu_item_slot_availability (menu_item_id, delivery_slot_id, day_of_week, available)
select '61111111-1111-1111-1111-111111111199', '51111111-1111-1111-1111-111111111199', dow, true
from generate_series(0, 6) as dow
on conflict do nothing;

insert into public.menu_item_inventory (id, menu_item_id, service_date, delivery_slot_id, quantity_total, quantity_reserved, quantity_sold, quantity_adjusted, active)
values ('71111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', 20, 2, 3, 0, true)
on conflict (menu_item_id, service_date, delivery_slot_id) do update
set quantity_total = excluded.quantity_total,
    quantity_reserved = excluded.quantity_reserved,
    quantity_sold = excluded.quantity_sold,
    quantity_adjusted = excluded.quantity_adjusted,
    active = excluded.active;

insert into public.menu_item_inventory (menu_item_id, service_date, delivery_slot_id, quantity_total, active)
select distinct mi.id, d.service_date, misa.delivery_slot_id, 25, true
from public.menu_items mi
join public.menu_item_slot_availability misa on misa.menu_item_id = mi.id
cross join lateral (
  select current_date + n as service_date
  from generate_series(1, 7) as n
) d
where misa.day_of_week = extract(dow from d.service_date)::integer
  and not (
  mi.id = '61111111-1111-1111-1111-111111111111'
  and d.service_date = current_date + 1
  and misa.delivery_slot_id = '51111111-1111-1111-1111-111111111113'
)
on conflict (menu_item_id, service_date, delivery_slot_id) do update
set quantity_total = excluded.quantity_total,
    active = excluded.active;

insert into public.orders (
  id, order_number, customer_id, campus_id, vendor_id, service_date, delivery_slot_id, location_id, zone_id,
  order_status, delivery_mode, food_subtotal_kobo, total_kobo, inventory_reservation_expires_at,
  paid_at, accepted_at, delivered_at, confirmed_at, cancelled_at, cancellation_reason
)
values
  ('81111111-1111-1111-1111-111111111111', 'MD-SEED-PENDING', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'pending_payment', 'meal_direct_rider', 20000, 35000, now() + interval '15 minutes', null, null, null, null, null, null),
  ('81111111-1111-1111-1111-111111111112', 'MD-SEED-PAID', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'paid', 'meal_direct_rider', 80000, 95000, null, now(), null, null, null, null, null),
  ('81111111-1111-1111-1111-111111111113', 'MD-SEED-VENDOR-DELIVERED', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111113', current_date + 1, '51111111-1111-1111-1111-111111111115', '22111111-1111-1111-1111-111111111112', '21111111-1111-1111-1111-111111111112', 'delivered', 'vendor_delivery', 150000, 165000, null, now(), now(), now(), null, null, null),
  ('81111111-1111-1111-1111-111111111114', 'MD-SEED-PREPARING', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111113', '21111111-1111-1111-1111-111111111111', 'preparing', 'meal_direct_rider', 130000, 145000, null, now(), now(), null, null, null, null),
  ('81111111-1111-1111-1111-111111111115', 'MD-SEED-REFUNDED', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111114', '21111111-1111-1111-1111-111111111112', 'refunded', 'meal_direct_rider', 20000, 35000, null, now(), now(), now(), now(), null, null),
  ('81111111-1111-1111-1111-111111111116', 'MD-SEED-CONFIRMED', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '22111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'confirmed', 'meal_direct_rider', 80000, 95000, null, now(), now(), now(), now(), null, null),
  ('81111111-1111-1111-1111-111111111199', 'MD-SEED-CROSS-CAMPUS', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', '11111111-1111-1111-1111-111111111199', '31111111-1111-1111-1111-111111111199', current_date + 1, '51111111-1111-1111-1111-111111111199', '22111111-1111-1111-1111-111111111199', '21111111-1111-1111-1111-111111111199', 'paid', 'meal_direct_rider', 100000, 115000, null, now(), null, null, null, null, null)
on conflict (id) do update
set order_status = excluded.order_status,
    paid_at = excluded.paid_at,
    accepted_at = excluded.accepted_at,
    delivered_at = excluded.delivered_at,
    confirmed_at = excluded.confirmed_at;

insert into public.order_items (id, order_id, menu_item_id, item_name, unit_type, unit_price_kobo, quantity, line_total_kobo)
values
  ('82111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111113', 'Table Water', 'bottle', 20000, 1, 20000),
  ('82111111-1111-1111-1111-111111111112', '81111111-1111-1111-1111-111111111112', '61111111-1111-1111-1111-111111111111', 'Jollof Rice', 'spoon', 80000, 1, 80000),
  ('82111111-1111-1111-1111-111111111113', '81111111-1111-1111-1111-111111111113', '61111111-1111-1111-1111-111111111131', 'Shawarma Combo', 'combo', 150000, 1, 150000),
  ('82111111-1111-1111-1111-111111111114', '81111111-1111-1111-1111-111111111114', '61111111-1111-1111-1111-111111111111', 'Jollof Rice', 'spoon', 80000, 1, 80000),
  ('82111111-1111-1111-1111-111111111115', '81111111-1111-1111-1111-111111111114', '61111111-1111-1111-1111-111111111112', 'Grilled Chicken', 'piece', 50000, 1, 50000),
  ('82111111-1111-1111-1111-111111111116', '81111111-1111-1111-1111-111111111115', '61111111-1111-1111-1111-111111111113', 'Table Water', 'bottle', 20000, 1, 20000),
  ('82111111-1111-1111-1111-111111111117', '81111111-1111-1111-1111-111111111116', '61111111-1111-1111-1111-111111111111', 'Jollof Rice', 'spoon', 80000, 1, 80000),
  ('82111111-1111-1111-1111-111111111199', '81111111-1111-1111-1111-111111111199', '61111111-1111-1111-1111-111111111199', 'Northgate Plate', 'plate', 100000, 1, 100000)
on conflict (id) do nothing;

insert into public.payments (id, order_id, provider, provider_reference, provider_transaction_id, status, expected_amount_kobo, paid_amount_kobo, currency, channel, initialized_at, verified_at, paid_at, provider_payload)
values
  ('91111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111', 'paystack', 'MD-SEED-PENDING', null, 'initialized', 35000, null, 'NGN', null, now(), null, null, '{}'),
  ('91111111-1111-1111-1111-111111111112', '81111111-1111-1111-1111-111111111112', 'paystack', 'MD-SEED-PAID', '1234567890', 'successful', 95000, 95000, 'NGN', 'card', now(), now(), now(), '{"seed":true}'),
  ('91111111-1111-1111-1111-111111111113', '81111111-1111-1111-1111-111111111115', 'paystack', 'MD-SEED-REFUNDED', '1234567891', 'refunded', 35000, 35000, 'NGN', 'card', now(), now(), now(), '{"seed":true}')
on conflict (provider, provider_reference) do update
set status = excluded.status,
    paid_amount_kobo = excluded.paid_amount_kobo,
    provider_payload = excluded.provider_payload;

insert into public.payment_events (id, provider, event_fingerprint, event_type, provider_reference, signature_valid, payload, received_at, processed_at)
values ('a1111111-1111-1111-1111-111111111111', 'paystack', 'seed-webhook-paid', 'charge.success', 'MD-SEED-PAID', true, '{"event":"charge.success","seed":true}', now(), now())
on conflict (provider, event_fingerprint) do nothing;

insert into public.refunds (id, payment_id, order_id, provider_refund_reference, amount_kobo, reason_code, reason_text, status, requested_by, approved_by, requested_at, processed_at, provider_payload)
values ('b1111111-1111-1111-1111-111111111111', '91111111-1111-1111-1111-111111111113', '81111111-1111-1111-1111-111111111115', 'RF_seed_001', 20000, 'defective_order', 'Seeded fictional refund.', 'succeeded', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', now(), now(), '{"seed":true}')
on conflict (id) do nothing;

insert into public.delivery_batches (id, campus_id, vendor_id, service_date, delivery_slot_id, zone_id, batch_number, status, delivery_mode, order_count, delivery_earnings_kobo, cutoff_at, closed_at)
values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', current_date + 1, '51111111-1111-1111-1111-111111111113', '21111111-1111-1111-1111-111111111111', 'MDB-SEED-RIDER', 'assigned', 'meal_direct_rider', 3, 22500, public.effective_ordering_cutoff_at(current_date + 1, '51111111-1111-1111-1111-111111111113'), now()),
  ('d1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111113', current_date + 1, '51111111-1111-1111-1111-111111111115', '21111111-1111-1111-1111-111111111112', 'MDB-SEED-VENDOR', 'completed', 'vendor_delivery', 1, 7500, public.effective_ordering_cutoff_at(current_date + 1, '51111111-1111-1111-1111-111111111115'), now())
on conflict (id) do update
set status = excluded.status,
    order_count = excluded.order_count,
    delivery_earnings_kobo = excluded.delivery_earnings_kobo;

insert into public.delivery_batch_orders (batch_id, order_id, sequence)
values
  ('d1111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111112', 1),
  ('d1111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111114', 2),
  ('d1111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111116', 3),
  ('d1111111-1111-1111-1111-111111111112', '81111111-1111-1111-1111-111111111113', 1)
on conflict (order_id) do nothing;

insert into public.delivery_assignments (id, batch_id, rider_id, vendor_id, assigned_by, status, assigned_at, accepted_at, picked_up_at, completed_at)
values
  ('c1111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', '32111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'accepted', now(), now(), null, null),
  ('c1111111-1111-1111-1111-111111111112', 'd1111111-1111-1111-1111-111111111112', null, '31111111-1111-1111-1111-111111111113', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'completed', now(), now(), now(), now())
on conflict (batch_id) do nothing;

insert into public.delivery_confirmations (id, order_id, customer_id, confirmed_at, metadata)
values ('cc111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111116', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', now(), '{"seed":true}')
on conflict (order_id) do nothing;

insert into public.escalations (id, order_id, opened_by, category, description, status, assigned_admin_id, resolution, refund_id, opened_at, resolved_at)
values ('ca111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111112', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'undelivered', 'Seeded fictional escalation for testing.', 'investigating', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', null, null, now(), null)
on conflict (id) do update
set status = excluded.status,
    assigned_admin_id = excluded.assigned_admin_id;

insert into public.reviews (id, order_id, reviewer_id, menu_item_id, vendor_id, delivery_batch_id, food_rating, vendor_rating, delivery_rating, comment, moderation_status)
values ('cb111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111116', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '61111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 5, 5, 4, 'Fictional seeded review.', 'approved')
on conflict (order_id, reviewer_id) do update
set food_rating = excluded.food_rating,
    vendor_rating = excluded.vendor_rating,
    delivery_rating = excluded.delivery_rating,
    comment = excluded.comment;

insert into public.settlements (id, campus_id, vendor_id, rider_id, settlement_date, status, gross_food_amount_kobo, delivery_earnings_kobo, refunds_kobo, adjustments_kobo, payable_kobo, created_by, approved_by, paid_at, external_reference)
values
  ('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', null, current_date + 1, 'approved', 80000, 0, 20000, 0, 60000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', null, 'SETTLE-SEED-VENDOR'),
  ('e1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', null, '32111111-1111-1111-1111-111111111111', current_date + 1, 'approved', 0, 7500, 0, 0, 7500, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', null, 'SETTLE-SEED-RIDER')
on conflict (id) do update
set status = excluded.status,
    gross_food_amount_kobo = excluded.gross_food_amount_kobo,
    delivery_earnings_kobo = excluded.delivery_earnings_kobo,
    refunds_kobo = excluded.refunds_kobo,
    payable_kobo = excluded.payable_kobo;

insert into public.settlement_lines (id, settlement_id, order_id, line_type, amount_kobo, description)
values
  ('e2111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111112', 'food', 80000, 'Seeded vendor food line.'),
  ('e2111111-1111-1111-1111-111111111112', 'e1111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111115', 'refund', -20000, 'Seeded vendor refund line.'),
  ('e2111111-1111-1111-1111-111111111113', 'e1111111-1111-1111-1111-111111111112', '81111111-1111-1111-1111-111111111112', 'rider_delivery', 7500, 'Seeded rider delivery line.')
on conflict (id) do nothing;

insert into public.audit_logs (id, actor_user_id, actor_type, campus_id, action, entity_type, entity_id, request_id, ip_address, user_agent, before_data, after_data, metadata)
values ('f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'admin', '11111111-1111-1111-1111-111111111111', 'seed.loaded', 'seed', null, 'seed-request', '127.0.0.1', 'supabase seed', null, '{"loaded":true}', '{"safe_sample_data":true}')
on conflict (id) do nothing;

insert into public.idempotency_keys (id, actor_user_id, operation, idempotency_key, request_hash, response_status, response_body, resource_id, expires_at)
values ('fa111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'create_order', 'seed-paid-order', 'seed-hash', 201, '{"order_id":"81111111-1111-1111-1111-111111111112"}', '81111111-1111-1111-1111-111111111112', now() + interval '1 day')
on conflict (actor_user_id, operation, idempotency_key) do update
set response_status = excluded.response_status,
    response_body = excluded.response_body,
    resource_id = excluded.resource_id,
    expires_at = excluded.expires_at;

insert into public.outbox_events (id, event_type, aggregate_type, aggregate_id, payload, available_at)
values
  ('fb111111-1111-1111-1111-111111111111', 'order.seeded', 'order', '81111111-1111-1111-1111-111111111112', '{"seed":true}', now()),
  ('fb111111-1111-1111-1111-111111111112', 'settlement.seeded', 'settlement', 'e1111111-1111-1111-1111-111111111111', '{"seed":true}', now())
on conflict (id) do nothing;

commit;
