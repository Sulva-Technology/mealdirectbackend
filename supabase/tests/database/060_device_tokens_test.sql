begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select has_table('public', 'device_tokens', 'device_tokens table exists');

select has_column('public', 'device_tokens', 'token', 'device_tokens has token column');

select col_is_unique('public', 'device_tokens', 'token', 'device_tokens.token is unique');

select * from finish();

rollback;
