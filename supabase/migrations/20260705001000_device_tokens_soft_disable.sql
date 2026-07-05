begin;

-- Soft-disable support: instead of hard-deleting dead FCM tokens (which made a
-- credential/project mismatch permanently destroy every token), mark them disabled
-- with a reason. Recoverable + auditable. tokensForUser filters disabled_at is null.
alter table public.device_tokens
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

-- Live-token lookups only ever want enabled rows.
create index if not exists device_tokens_active_user_idx
  on public.device_tokens (user_id)
  where disabled_at is null;

comment on column public.device_tokens.disabled_at is 'When the token was disabled after a permanent FCM send failure; null = active.';
comment on column public.device_tokens.disabled_reason is 'FCM error code that caused the token to be disabled (e.g. messaging/registration-token-not-registered).';

commit;
