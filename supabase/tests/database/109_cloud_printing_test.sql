begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

select has_table('public', 'feature_flags', 'feature_flags exists');
select has_table('public', 'feature_testers', 'feature_testers exists');
select has_table('public', 'vendor_printers', 'vendor_printers exists');
select has_table('public', 'print_jobs', 'print_jobs exists');
select is(
  (select mode from public.feature_flags where key = 'cloud_printing'),
  'test',
  'cloud_printing is seeded in test mode'
);

-- Seed inserts paid orders after this migration's trigger exists, but no vendor has a
-- printer yet, so nothing was queued.
select is(
  (select count(*)::integer from public.print_jobs),
  0,
  'paid orders queue nothing for vendors without a printer'
);

-- Register two printers for vendor 31111111-…-1.
insert into public.vendor_printers (id, vendor_id, name, mac_address, key_hash)
values
  ('a1111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'Front',
   '00:11:62:aa:bb:01', repeat('a', 64)),
  ('a1111111-1111-1111-1111-111111111112', '31111111-1111-1111-1111-111111111111', 'Back',
   '00:11:62:aa:bb:02', repeat('b', 64));

select throws_ok(
  $$insert into public.vendor_printers (vendor_id, name, mac_address, key_hash)
    values ('31111111-1111-1111-1111-111111111111', 'Dup', '00:11:62:aa:bb:01', repeat('c', 64))$$,
  '23505',
  null,
  'a live MAC can only be registered once'
);

-- The pending order becomes paid → trigger queues exactly one job.
update public.orders set paid_at = now() where id = '81111111-1111-1111-1111-111111111111';
update public.orders set paid_at = now() + interval '1 second' where id = '81111111-1111-1111-1111-111111111111';
select is(
  (select count(*)::integer from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
  1,
  'first paid_at queues one job; later updates do not duplicate'
);
select ok(
  (select print_after >= now() from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
  'print_after is never in the past'
);

-- Not due yet (slot cutoff is tomorrow) → nothing to claim.
select is(
  public.claim_print_job('a1111111-1111-1111-1111-111111111111', 120, 12),
  null,
  'job before its cutoff is not claimed'
);

-- Make it due, plus a due job for a refunded order that must be skipped.
update public.print_jobs set print_after = now() - interval '1 minute'
  where order_id = '81111111-1111-1111-1111-111111111111';
insert into public.print_jobs (vendor_id, order_id, print_after)
values ('31111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111115', now() - interval '2 minutes');

select is(
  public.claim_print_job('a1111111-1111-1111-1111-111111111111', 120, 12),
  (select id from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
  'first printer claims the due job, skipping the refunded order'
);
select is(
  public.claim_print_job('a1111111-1111-1111-1111-111111111111', 120, 12),
  (select id from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
  're-polling returns the same live lease'
);
select is(
  public.claim_print_job('a1111111-1111-1111-1111-111111111112', 120, 12),
  null,
  'second printer cannot take a leased job'
);

select is(
  public.complete_print_job(
    (select id from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
    'a1111111-1111-1111-1111-111111111112', true, null, 5),
  null,
  'a printer without the lease cannot complete the job'
);
select is(
  public.complete_print_job(
    (select id from public.print_jobs where order_id = '81111111-1111-1111-1111-111111111111'),
    'a1111111-1111-1111-1111-111111111111', false, '520 Paper empty', 1),
  'failed',
  'a failure at max attempts marks the job failed'
);

select throws_ok(
  $$insert into public.feature_flags (key, mode) values ('bad_mode', 'maybe')$$,
  '23514',
  null,
  'flag mode is constrained to off/test/on'
);

select * from finish();
rollback;
