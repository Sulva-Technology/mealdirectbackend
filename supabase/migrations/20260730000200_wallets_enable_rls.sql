begin;

-- Fix (final review, slice A gap): 20260727000200_wallets.sql created wallets,
-- wallet_ledger_entries and wallet_dedicated_accounts without enabling row-level security and
-- without revoking from anon/authenticated. The sibling migration 20260727000100 DID enable RLS
-- on platform_settings "like other admin-only finance tables". On hosted Supabase, new public
-- tables are default-granted to anon/authenticated, and the one-time revoke in
-- 20260612000500_rls_privileges_security.sql only covered tables that existed then — so without
-- explicit RLS these three financial tables were reachable through PostgREST by any authenticated
-- user (read every customer's balance and dedicated-account NUBAN; potentially write ledger rows,
-- bypassing append_wallet_ledger_entry).
--
-- Deny-all RLS with no policies: only the privileged application role (which bypasses RLS) can
-- read or write, matching platform_settings and the other admin-only finance tables. All wallet
-- access already flows through SECURITY DEFINER functions, so no policies are needed.
alter table public.wallets enable row level security;
alter table public.wallet_ledger_entries enable row level security;
alter table public.wallet_dedicated_accounts enable row level security;

-- Re-affirm the source-of-truth note now that the ledger is RLS-protected (comment text unchanged).
comment on table public.wallet_ledger_entries is 'Append-only signed wallet movements. Credits are positive, debits negative; balance_after_kobo snapshots the wallet balance immediately after the entry. RLS deny-all: only the privileged application role (bypassing RLS) writes, exclusively through append_wallet_ledger_entry.';

commit;
