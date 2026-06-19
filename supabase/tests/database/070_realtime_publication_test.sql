begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select ok(
  (select exists(select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders')),
  'orders in realtime publication'
);

select ok(
  (select exists(select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications')),
  'notifications in realtime publication'
);

select ok(
  (select exists(select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_assignments')),
  'delivery_assignments in realtime publication'
);

select * from finish();

rollback;
