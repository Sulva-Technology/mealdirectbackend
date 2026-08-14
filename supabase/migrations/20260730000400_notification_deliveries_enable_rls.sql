begin;

-- Fix (parity with 20260730000200_wallets_enable_rls.sql): 20260619001100_notification_deliveries.sql
-- created public.notification_deliveries without enabling row-level security. The one-time revoke in
-- 20260612000500_rls_privileges_security.sql predates this table, so on hosted Supabase — where new
-- public tables are default-granted to anon/authenticated — the per-user delivery telemetry
-- (notification linkage, device/channel, delivery status) was reachable through PostgREST.
--
-- notification_deliveries is written only by the outbox/notification pipeline running under the
-- privileged application role (which bypasses RLS); no client reads it. Deny-all RLS with no
-- policies matches notifications' sibling backend tables and the wallet finance tables. The
-- explicit revoke is defence-in-depth against hosted default grants.
alter table public.notification_deliveries enable row level security;

revoke all on public.notification_deliveries from anon, authenticated;

comment on table public.notification_deliveries is 'Per-recipient delivery telemetry for the notification pipeline. RLS deny-all: only the privileged application role (bypassing RLS) reads or writes it; no client access.';

commit;
