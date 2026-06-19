begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select has_column('public', 'riders', 'available', 'riders has available column');

select col_not_null('public', 'riders', 'available', 'riders.available is not null');

select has_index('public', 'riders', 'riders_available_idx', 'riders_available_idx exists');

select * from finish();

rollback;
