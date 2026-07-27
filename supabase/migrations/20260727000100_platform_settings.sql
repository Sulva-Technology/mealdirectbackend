begin;

-- Generic operator-tunable settings. Until now every tunable value was either an
-- environment variable or a column on vendors/campuses/campus_zones, which meant a
-- deploy to change a number. Slice A introduces the wallet limits here; slice B
-- (fee splits) reuses the same table.
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_settings_key_not_blank check (length(btrim(key)) > 0)
);

comment on table public.platform_settings is 'Operator-tunable platform configuration as key/jsonb pairs. Edited by admins through PATCH /admin/settings and audited.';
comment on column public.platform_settings.value is 'Raw jsonb. Integer settings store a bare JSON number, e.g. 50000.';

create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

-- Read an integer setting, falling back to p_default when the key is absent or is
-- not a JSON number. Callers pass the same default the application would use so a
-- missing row can never change pricing behaviour.
create or replace function public.platform_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer end
      from public.platform_settings s
      where s.key = p_key
    ),
    p_default
  );
$$;

comment on function public.platform_setting_int(text, integer) is 'Reads an integer platform setting, returning p_default when the key is missing or not a JSON number.';

insert into public.platform_settings (key, value, description)
values
  ('wallet_min_topup_kobo', to_jsonb(50000), 'Advisory minimum wallet top-up in kobo (₦500). UI guidance only — inbound transfers are always credited in full.'),
  ('wallet_max_balance_kobo', to_jsonb(5000000), 'Advisory maximum wallet balance in kobo (₦50,000). Credits crossing it still apply and raise an admin flag.')
on conflict (key) do nothing;

commit;
