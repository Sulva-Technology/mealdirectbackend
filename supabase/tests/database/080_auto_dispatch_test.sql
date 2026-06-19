begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(2);

select has_function(
  'public',
  'assign_available_rider_to_batch',
  array['uuid'],
  'assign_available_rider_to_batch(uuid) exists'
);

-- An unknown batch id has no batch row, so the function returns null rather than raising.
select is(
  public.assign_available_rider_to_batch('00000000-0000-4000-8000-000000000000'::uuid),
  null,
  'returns null for an unknown batch'
);

select * from finish();

rollback;
