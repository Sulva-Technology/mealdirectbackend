begin;

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add column gender text,
  add constraint profiles_gender_valid check (gender is null or gender in ('Male', 'Female'));

comment on column public.profiles.first_name is 'Given name captured during account signup or profile updates.';
comment on column public.profiles.last_name is 'Family name captured during account signup or profile updates.';
comment on column public.profiles.gender is 'Self-reported gender (Male or Female) captured during rider signup.';

-- Persist rider/user signup metadata (first_name, last_name, display_name, phone, gender)
-- alongside the referral code when an auth user is created.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_phone text;
  v_gender text;
begin
  v_first_name := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last_name := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  v_display_name := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      )
    ),
    ''
  );

  if v_display_name is null and (v_first_name is not null or v_last_name is not null) then
    v_display_name := nullif(btrim(concat_ws(' ', v_first_name, v_last_name)), '');
  end if;

  v_phone := nullif(
    btrim(coalesce(new.raw_user_meta_data ->> 'phone', new.raw_user_meta_data ->> 'phone_number')),
    ''
  );
  if v_phone is not null and v_phone !~ '^[+0-9][0-9 ()-]{6,24}$' then
    v_phone := null;
  end if;

  v_gender := case
    when (new.raw_user_meta_data ->> 'gender') in ('Male', 'Female')
      then new.raw_user_meta_data ->> 'gender'
    else null
  end;

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    display_name,
    phone_number,
    gender,
    avatar_url,
    referral_code
  )
  values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    v_display_name,
    v_phone,
    v_gender,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    public.generate_referral_code()
  )
  on conflict (id) do update
  set email = excluded.email,
      first_name = coalesce(public.profiles.first_name, excluded.first_name),
      last_name = coalesce(public.profiles.last_name, excluded.last_name),
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      phone_number = coalesce(public.profiles.phone_number, excluded.phone_number),
      gender = coalesce(public.profiles.gender, excluded.gender),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
      updated_at = now();

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates an application profile for new Auth users with safe personal metadata without trusting metadata for roles or privileged state.';

commit;
