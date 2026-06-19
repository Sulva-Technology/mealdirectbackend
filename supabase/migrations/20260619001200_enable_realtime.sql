begin;

-- Add the user-facing live tables to the managed Supabase Realtime publication so
-- authenticated clients can subscribe to postgres_changes (RLS still applies per row).
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.delivery_assignments;

comment on table public.orders is 'One takeaway package order from one customer to one vendor for one campus date, slot, and location. Streamed over Supabase Realtime.';
comment on table public.notifications is 'User-facing in-app notifications materialized from transactional outbox events. Streamed over Supabase Realtime.';
comment on table public.delivery_assignments is 'Manual delivery fulfilment assignment for a batch, either a Meal Direct rider or the vendor. Streamed over Supabase Realtime.';

commit;
