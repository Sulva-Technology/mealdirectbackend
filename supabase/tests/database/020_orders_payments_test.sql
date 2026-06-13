begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

select is(
  (
    select food_subtotal_kobo + delivery_fee_kobo - discount_kobo
    from public.orders
    where id = '81111111-1111-1111-1111-111111111112'
  ),
  (
    select total_kobo
    from public.orders
    where id = '81111111-1111-1111-1111-111111111112'
  ),
  'order total equals food subtotal plus delivery fee minus discount'
);

select is(
  (
    select delivery_fee_kobo
    from public.orders
    where id = '81111111-1111-1111-1111-111111111112'
  ),
  15000,
  'delivery fee is fixed at NGN 150 in kobo'
);

select is(
  (
    select platform_delivery_share_kobo
    from public.orders
    where id = '81111111-1111-1111-1111-111111111112'
  ),
  7500,
  'platform delivery share is fixed at NGN 75 in kobo'
);

select is(
  (
    select fulfiller_delivery_share_kobo
    from public.orders
    where id = '81111111-1111-1111-1111-111111111112'
  ),
  7500,
  'fulfiller delivery share is fixed at NGN 75 in kobo'
);

select throws_ok(
  $$ update public.order_items
     set quantity = quantity + 1
     where order_id = '81111111-1111-1111-1111-111111111112' $$,
  '23000',
  null::text,
  'paid order items cannot be changed directly'
);

select throws_ok(
  $$ update public.orders
     set total_kobo = total_kobo + 100
     where id = '81111111-1111-1111-1111-111111111112' $$,
  '23000',
  null::text,
  'paid order financial snapshots cannot change'
);

select throws_ok(
  $$ insert into public.payments (
       order_id,
       provider,
       provider_reference,
       expected_amount_kobo
     )
     values (
       '81111111-1111-1111-1111-111111111112',
       'paystack',
       'MD-SEED-PAID',
       45000
     ) $$,
  '23505',
  null::text,
  'duplicate payment references are rejected'
);

select ok(
  public.record_payment_event(
    'paystack',
    'seed-webhook-new',
    'charge.success',
    'MD-SEED-PAID',
    true,
    '{"event":"charge.success"}'::jsonb
  ),
  'new webhook event is recorded'
);

select is(
  public.record_payment_event(
    'paystack',
    'seed-webhook-new',
    'charge.success',
    'MD-SEED-PAID',
    true,
    '{"event":"charge.success"}'::jsonb
  ),
  false,
  'duplicate webhook event is ignored'
);

select throws_ok(
  $$ select public.transition_order_status(
       '81111111-1111-1111-1111-111111111112',
       'pending_payment',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
       'invalid regression'
     ) $$,
  '23514',
  null::text,
  'invalid order status transitions are rejected'
);

select is(
  public.calculate_delivery_earnings(3),
  22500,
  'batch earnings equal NGN 75 in kobo times eligible order count'
);

select is(
  (
    select payable_kobo
    from public.settlements
    where id = 'e1111111-1111-1111-1111-111111111111'
  ),
  (
    select gross_food_amount_kobo + delivery_earnings_kobo - refunds_kobo + adjustments_kobo
    from public.settlements
    where id = 'e1111111-1111-1111-1111-111111111111'
  ),
  'vendor settlement arithmetic is consistent'
);

select isnt_empty(
  $$ select 1
     from public.orders
     where id = '81111111-1111-1111-1111-111111111113'
       and delivery_mode = 'vendor_delivery'
       and fulfiller_delivery_share_kobo = 7500 $$,
  'vendor-delivered order carries vendor delivery earnings'
);

select isnt_empty(
  $$ select 1
     from public.orders
     where id = '81111111-1111-1111-1111-111111111112'
       and delivery_mode = 'meal_direct_rider'
       and fulfiller_delivery_share_kobo = 7500 $$,
  'rider-delivered order carries rider delivery earnings'
);

select * from finish();

rollback;
