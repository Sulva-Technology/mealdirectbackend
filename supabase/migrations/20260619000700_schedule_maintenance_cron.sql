begin;

create extension if not exists pg_cron with schema extensions;

-- Named schedules upsert by job name, so reruns are idempotent.
select cron.schedule(
  'release-expired-reservations',
  '*/5 * * * *',
  $$ select public.release_expired_reservations(); $$
);

select cron.schedule(
  'close-batches-at-cutoff',
  '* * * * *',
  $$ select public.close_batches_at_cutoff(); $$
);

-- Document the scheduled maintenance functions.
comment on function public.release_expired_reservations() is 'Releases inventory for pending-payment orders whose payment reservation window expired. Scheduled via pg_cron every 5 minutes.';
comment on function public.close_batches_at_cutoff() is 'Closes open delivery batches once their ordering cutoff has passed. Scheduled via pg_cron every minute.';

commit;
