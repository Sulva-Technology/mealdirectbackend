begin;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  status text not null check (status in ('sent', 'failed')),
  detail text,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_unique unique (notification_id, channel)
);

create index notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id);

comment on table public.notification_deliveries is 'Per-channel delivery log for materialized notifications, ensuring each channel is sent at most once.';
comment on column public.notification_deliveries.channel is 'Delivery channel: email or push.';
comment on column public.notification_deliveries.status is 'Delivery outcome: sent or failed.';
comment on column public.notification_deliveries.detail is 'Optional provider detail or error message captured at delivery time.';

commit;
