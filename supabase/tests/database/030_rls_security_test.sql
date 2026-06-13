begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

select ok(
  (
    select bool_and(rowsecurity)
    from pg_tables
    where schemaname = 'public'
  ),
  'RLS is enabled on every public table'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  null::text,
  'anonymous users cannot read profiles'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', true);

select is(
  (
    select count(*)
    from public.orders
    where customer_id <> auth.uid()
  ),
  0::bigint,
  'customer cannot read another customer order through RLS'
);

select cmp_ok(
  (
    select count(*)
    from public.orders
    where customer_id = auth.uid()
  ),
  '>=',
  1::bigint,
  'customer can read own orders through RLS'
);

select throws_ok(
  $$ insert into public.admin_memberships (user_id, role)
     values (auth.uid(), 'super_admin') $$,
  '42501',
  null::text,
  'customer cannot grant themselves an admin role'
);

select throws_ok(
  $$ select count(*) from public.vendor_payout_accounts $$,
  '42501',
  null::text,
  'authenticated users cannot directly read vendor payout accounts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', true);

select is(
  (
    select count(*)
    from public.orders
    where vendor_id <> '31111111-1111-1111-1111-111111111111'
  ),
  0::bigint,
  'vendor owner cannot read another vendor order'
);

select is(
  (
    select count(*)
    from public.menu_item_inventory inv
    join public.menu_items mi on mi.id = inv.menu_item_id
    where mi.vendor_id <> '31111111-1111-1111-1111-111111111111'
  ),
  0::bigint,
  'vendor owner cannot read another vendor inventory'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', true);

select is(
  (
    select count(*)
    from public.delivery_batches db
    where not exists (
      select 1
      from public.delivery_assignments da
      join public.riders r on r.id = da.rider_id
      where da.batch_id = db.id
        and r.user_id = auth.uid()
    )
  ),
  0::bigint,
  'rider sees only assigned batches'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', true);

select isnt_empty(
  $$ select 1 from public.orders where campus_id = '11111111-1111-1111-1111-111111111111' $$,
  'campus admin can read own campus orders'
);

select is_empty(
  $$ select 1 from public.orders where campus_id <> '11111111-1111-1111-1111-111111111111' $$,
  'campus admin cannot read cross-campus orders'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', true);

select isnt_empty(
  $$ select 1 from public.admin_memberships $$,
  'super admin can read admin memberships'
);

select lives_ok(
  $$ update public.admin_memberships
     set active = active
     where role = 'campus_admin'
       and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4' $$,
  'super admin can manage admin memberships'
);
reset role;

select throws_ok(
  $$ update public.audit_logs
     set metadata = '{"changed":true}'::jsonb
     where id = 'f1111111-1111-1111-1111-111111111111' $$,
  '23000',
  null::text,
  'audit logs cannot be mutated even by ordinary SQL updates'
);

select throws_ok(
  $$ update public.settlement_lines
     set amount_kobo = amount_kobo + 1
     where settlement_id = 'e1111111-1111-1111-1111-111111111111' $$,
  '23000',
  null::text,
  'settlement lines are append-only financial history'
);

select * from finish();

rollback;
