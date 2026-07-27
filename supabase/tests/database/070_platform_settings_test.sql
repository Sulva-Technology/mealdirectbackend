begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

select has_table('public', 'platform_settings', 'platform_settings table exists');

select is(
  public.platform_setting_int('wallet_min_topup_kobo', 0),
  50000,
  'minimum top-up seeds to ₦500'
);

select is(
  public.platform_setting_int('wallet_max_balance_kobo', 0),
  5000000,
  'maximum balance seeds to ₦50,000'
);

select is(
  public.platform_setting_int('no_such_setting', 4242),
  4242,
  'unknown keys fall back to the supplied default'
);

select * from finish();
rollback;
