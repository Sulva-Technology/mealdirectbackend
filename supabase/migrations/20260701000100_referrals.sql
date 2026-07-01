begin;

-- Unique, human-shareable referral code carried by every profile.
alter table public.profiles
  add column referral_code text unique;

comment on column public.profiles.referral_code is
  'Unique shareable referral code. Crockford base32 (no ambiguous chars). Assigned once at profile creation and immutable thereafter.';

-- Generates a random 8-char Crockford base32 code (excludes I, L, O, U to avoid ambiguity).
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;

    -- Retry on the rare collision instead of failing the caller.
    exit when not exists (
      select 1 from public.profiles where referral_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

comment on function public.generate_referral_code() is
  'Returns a collision-checked 8-char Crockford base32 referral code.';

-- Assigns a referral code to a profile if it does not have one yet. Idempotent.
create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  existing text;
begin
  select referral_code into existing from public.profiles where id = p_user_id;

  if existing is not null then
    return existing;
  end if;

  update public.profiles
    set referral_code = public.generate_referral_code(),
        updated_at = now()
    where id = p_user_id
    returning referral_code into existing;

  return existing;
end;
$$;

comment on function public.ensure_referral_code(uuid) is
  'Lazily assigns and returns the profile referral code, generating one on first use.';

-- Backfill codes for every existing profile.
update public.profiles
  set referral_code = public.generate_referral_code()
  where referral_code is null;

-- One referrer per referred user, immutable once written.
create table public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referred_id  uuid not null unique references public.profiles(id) on delete restrict,
  referrer_id  uuid not null references public.profiles(id) on delete restrict,
  code_used    text not null,
  created_at   timestamptz not null default now(),
  constraint referrals_no_self check (referred_id <> referrer_id)
);

create index referrals_referrer_idx on public.referrals (referrer_id);

comment on table public.referrals is
  'Records which existing user (referrer) introduced a new user (referred). Bound once at signup; one referrer per referred user.';
comment on column public.referrals.referred_id is 'The newly-signed-up user who redeemed a referral code.';
comment on column public.referrals.referrer_id is 'The existing user whose code was redeemed.';
comment on column public.referrals.code_used is 'Snapshot of the referral code string that was redeemed.';

-- Assign a code to new auth users at profile creation time.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, referral_code)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    public.generate_referral_code()
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
      updated_at = now();

  return new;
end;
$$;

-- Row level security: users read their own referral rows (as referrer or referred).
-- Admin analytics runs through the privileged backend role, which bypasses RLS.
alter table public.referrals enable row level security;
grant select on public.referrals to authenticated;

create policy referrals_read_own on public.referrals
for select to authenticated
using (referrer_id = auth.uid() or referred_id = auth.uid());

commit;
