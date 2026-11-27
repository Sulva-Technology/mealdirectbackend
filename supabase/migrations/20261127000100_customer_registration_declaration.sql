begin;

alter table public.profiles
  add column declaration_confirmed_at timestamptz;

create or replace function public.record_signup_declaration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'declaration_confirmed' = 'true' then
    update public.profiles
    set declaration_confirmed_at = coalesce(declaration_confirmed_at, now())
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger z_auth_user_record_signup_declaration
after insert on auth.users
for each row execute function public.record_signup_declaration();

comment on column public.profiles.declaration_confirmed_at is
  'Time the user confirmed the information accuracy declaration during account registration.';

commit;
