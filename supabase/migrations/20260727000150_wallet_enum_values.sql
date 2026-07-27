begin;

-- Enum values only. Postgres cannot USE a value added by `alter type ... add value`
-- inside the transaction that added it, and each migration file is one transaction.
-- Everything that references these values lives in 20260727000200 and later.

alter type public.payment_provider add value if not exists 'wallet';

alter type public.payment_reconciliation_issue_type add value if not exists 'wallet_balance_drift';
alter type public.payment_reconciliation_issue_type add value if not exists 'wallet_balance_cap_exceeded';

commit;
