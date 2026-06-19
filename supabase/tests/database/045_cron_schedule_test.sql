begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(2);

select ok(
  exists (select 1 from cron.job where jobname = 'release-expired-reservations'),
  'release-expired-reservations cron job is scheduled'
);

select ok(
  exists (select 1 from cron.job where jobname = 'close-batches-at-cutoff'),
  'close-batches-at-cutoff cron job is scheduled'
);

select * from finish();

rollback;
