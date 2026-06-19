begin;

alter table public.riders
  add column if not exists available boolean not null default false;

comment on column public.riders.available is 'Rider self-service on/off-shift flag; only available riders are eligible for auto-dispatch.';

create index if not exists riders_available_idx
  on public.riders (campus_id, available) where available;

commit;
