begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

select has_table('public', 'notification_deliveries', 'notification_deliveries table exists');

select has_column('public', 'notification_deliveries', 'channel', 'notification_deliveries has channel column');

select col_is_unique(
  'public',
  'notification_deliveries',
  array['notification_id', 'channel'],
  'notification_deliveries (notification_id, channel) is unique'
);

select * from finish();

rollback;
