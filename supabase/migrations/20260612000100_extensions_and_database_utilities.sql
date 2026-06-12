begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app_private;
comment on schema app_private is 'Internal helper schema for Meal Direct database implementation details.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is 'Maintains updated_at on mutable Meal Direct business tables.';

create or replace function public.prevent_update_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only and cannot be updated or deleted', tg_table_name
    using errcode = '23000';
end;
$$;

comment on function public.prevent_update_delete() is 'Rejects UPDATE and DELETE on append-only operational and financial history tables.';

create or replace function public.non_negative_kobo(p_amount integer)
returns boolean
language sql
immutable
as $$
  select p_amount >= 0;
$$;

comment on function public.non_negative_kobo(integer) is 'Shared predicate documenting integer-kobo non-negative money constraints.';

commit;
