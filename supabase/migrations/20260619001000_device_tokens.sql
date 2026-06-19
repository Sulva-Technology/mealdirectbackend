begin;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_token_unique unique (token)
);

create index device_tokens_user_idx on public.device_tokens (user_id);

create trigger device_tokens_set_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

alter table public.device_tokens enable row level security;
grant select, insert, delete on public.device_tokens to authenticated;

create policy device_tokens_manage_own on public.device_tokens
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.device_tokens is 'Push notification device tokens (FCM) registered per user for mobile/web delivery.';
comment on column public.device_tokens.token is 'Provider device/registration token; unique across users so re-registration reassigns ownership.';
comment on column public.device_tokens.platform is 'Originating client platform: ios, android, or web.';

commit;
