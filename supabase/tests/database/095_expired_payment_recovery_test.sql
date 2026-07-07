begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

-- Simulate release_expired_reservations() winning the race: the seeded pending order
-- MD-SEED-PENDING is flipped to `expired` while its Paystack payment is still `initialized`.
update public.orders
set order_status = 'expired',
    cancelled_at = now(),
    cancellation_reason = 'payment reservation expired'
where id = '81111111-1111-1111-1111-111111111111';

-- Provider confirms the money after expiry (webhook / reconcile sweep).
select lives_ok(
  $$ select public.mark_verified_payment_successful(
       'paystack',
       'MD-SEED-PENDING',
       'TXN-RECOVER-001',
       35000,
       '{"recovered":true}'::jsonb
     ) $$,
  'verifying a captured payment on an expired order does not error'
);

select is(
  (select order_status::text from public.orders where id = '81111111-1111-1111-1111-111111111111'),
  'paid',
  'expired order is auto-recovered to paid once the payment is confirmed'
);

select is(
  (select status::text from public.payments where provider = 'paystack' and provider_reference = 'MD-SEED-PENDING'),
  'successful',
  'the captured payment is marked successful'
);

select is(
  (select cancellation_reason from public.orders where id = '81111111-1111-1111-1111-111111111111'),
  null,
  'the expiry cancellation reason is cleared on recovery'
);

select isnt_empty(
  $$ select 1
     from public.order_status_history
     where order_id = '81111111-1111-1111-1111-111111111111'
       and from_status = 'expired'
       and to_status = 'paid' $$,
  'a truthful expired -> paid history row is written'
);

select * from finish();

rollback;
