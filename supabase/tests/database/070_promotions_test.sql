begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

select has_table('public', 'promotions', 'promotions table exists');
select has_table('public', 'promotion_redemptions', 'promotion_redemptions table exists');

select throws_ok(
  $$ insert into public.promotions (code, discount_type, discount_value)
     values ('PCT_OVER', 'percent', 150) $$,
  '23514',
  null::text,
  'percent discount value above 100 is rejected'
);

select lives_ok(
  $$ insert into public.promotions (code, discount_type, discount_value)
     values ('SAVE10', 'percent', 10) $$,
  'a valid percent code is accepted'
);

select throws_ok(
  $$ insert into public.promotions (code, discount_type, discount_value)
     values ('SAVE10', 'fixed', 5000) $$,
  '23505',
  null::text,
  'duplicate promotion code is rejected'
);

select * from finish();

rollback;
