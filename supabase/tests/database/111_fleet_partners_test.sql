begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

select has_table('public', 'fleet_partners', 'fleet_partners exists');
select has_table('public', 'fleet_partner_members', 'fleet_partner_members exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.fleet_partners'::regclass),
  true,
  'fleet_partners has RLS enabled'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.fleet_partner_members'::regclass),
  true,
  'fleet_partner_members has RLS enabled'
);

select is(
  has_table_privilege('authenticated', 'public.fleet_partners', 'select'),
  false,
  'authenticated clients cannot read fleet partners directly'
);

select is(
  has_function_privilege('authenticated', 'public.fleet_assign_batch(uuid, uuid, uuid, uuid)', 'execute'),
  false,
  'authenticated clients cannot call fleet_assign_batch directly'
);

-- Fixtures: one partner on the seed campus, one on the second campus, and two fresh
-- rider-delivered batches on the seed campus.
insert into public.fleet_partners (id, campus_id, name, join_code)
values
  ('f1111111-1111-4111-8111-111111111111', '11111111-1111-1111-1111-111111111111', 'Swift Logistics', 'SWIFT001'),
  ('f1111111-1111-4111-8111-111111111199', '11111111-1111-1111-1111-111111111199', 'Northgate Couriers', 'NORTH001');

insert into public.delivery_batches (
  id, campus_id, vendor_id, service_date, delivery_slot_id, zone_id, batch_number, status,
  delivery_mode, cutoff_at
)
values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', '2030-01-01', '51111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'FLEET-TEST-1', 'closed', 'meal_direct_rider',
   '2030-01-01 09:00:00+00'),
  ('e1111111-1111-4111-8111-111111111112', '11111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', '2030-01-02', '51111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'FLEET-TEST-2', 'closed', 'meal_direct_rider',
   '2030-01-02 09:00:00+00');

select throws_ok(
  $$insert into public.fleet_partners (campus_id, name, join_code)
    values ('11111111-1111-1111-1111-111111111111', 'Bad Code Co', 'bad-code')$$,
  '23514',
  null,
  'a join code must be 6-12 uppercase letters or digits'
);

select throws_ok(
  $$insert into public.fleet_partners (campus_id, name, join_code, commission_bps)
    values ('11111111-1111-1111-1111-111111111111', 'Greedy Co', 'GREEDY01', 10001)$$,
  '23514',
  null,
  'commission cannot exceed 100%'
);

select throws_ok(
  $$update public.riders set fleet_partner_id = 'f1111111-1111-4111-8111-111111111199'
    where id = '32111111-1111-1111-1111-111111111111'$$,
  '23514',
  null,
  'a rider cannot join a fleet on another campus'
);

select lives_ok(
  $$update public.riders set fleet_partner_id = 'f1111111-1111-4111-8111-111111111111'
    where id = '32111111-1111-1111-1111-111111111111'$$,
  'a rider can join a fleet on its own campus'
);

select isnt(
  public.fleet_assign_batch(
    'f1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111111',
    '32111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  ),
  null,
  'a fleet manager can dispatch an unassigned batch to a fleet rider'
);

select is(
  (select fleet_partner_id from public.delivery_assignments
   where batch_id = 'e1111111-1111-4111-8111-111111111111'),
  'f1111111-1111-4111-8111-111111111111'::uuid,
  'the assignment snapshots the rider''s fleet partner'
);

select is(
  (select status::text from public.delivery_batches where id = 'e1111111-1111-4111-8111-111111111111'),
  'assigned',
  'the dispatched batch moves to assigned'
);

select throws_ok(
  $$select public.fleet_assign_batch(
    'f1111111-1111-4111-8111-111111111111',
    'd1111111-1111-1111-1111-111111111111',
    '32111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  )$$,
  'FP409',
  null,
  'a batch whose rider already accepted it cannot be re-dispatched'
);

select throws_ok(
  $$select public.fleet_assign_batch(
    'f1111111-1111-4111-8111-111111111199',
    'e1111111-1111-4111-8111-111111111112',
    '32111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  )$$,
  'FP404',
  null,
  'a partner cannot see batches on another campus'
);

update public.fleet_partners set can_dispatch = false
where id = 'f1111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select public.fleet_assign_batch(
    'f1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111112',
    '32111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  )$$,
  'FP403',
  null,
  'a partner with dispatch disabled cannot assign'
);

update public.fleet_partners set can_dispatch = true, status = 'suspended'
where id = 'f1111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select public.fleet_assign_batch(
    'f1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111112',
    '32111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  )$$,
  'FP403',
  null,
  'a suspended partner cannot assign'
);

-- Auto-dispatch must skip riders of a suspended partner, then pick them up again once the
-- partner is reactivated.
update public.riders set available = true where id = '32111111-1111-1111-1111-111111111111';

select is(
  public.assign_available_rider_to_batch('e1111111-1111-4111-8111-111111111112'),
  null,
  'auto-dispatch skips riders whose fleet partner is suspended'
);

update public.fleet_partners set status = 'active'
where id = 'f1111111-1111-4111-8111-111111111111';

select isnt(
  public.assign_available_rider_to_batch('e1111111-1111-4111-8111-111111111112'),
  null,
  'auto-dispatch uses fleet riders again once the partner is active'
);

select is(
  (select fleet_partner_id from public.delivery_assignments
   where batch_id = 'e1111111-1111-4111-8111-111111111112'),
  'f1111111-1111-4111-8111-111111111111'::uuid,
  'auto-dispatched assignments also snapshot the fleet partner'
);

select * from finish();

rollback;
