begin;

-- 1) Multi-attempt payouts. A failed transfer must be retryable with a FRESH Paystack
--    reference (a reused reference is rejected), so payout_transfers becomes one row per
--    attempt. reconcile_payout_transfer still looks rows up by reference (unchanged), and
--    each attempt's reference stays globally unique via payout_transfers_reference_unique.
alter table public.payout_transfers
  add column if not exists attempt integer not null default 1;

alter table public.payout_transfers
  drop constraint payout_transfers_settlement_unique;

alter table public.payout_transfers
  add constraint payout_transfers_settlement_attempt_key unique (settlement_id, attempt);

comment on column public.payout_transfers.attempt is 'Retry attempt number for this settlement; reference is <settlementId>-a<attempt>. Bounded by payout_max_attempts.';

-- 2) Guardrail settings. Read through platform_setting_int(key, default) so a missing or
--    malformed row falls back to the app default and can never silently change payout behaviour.
insert into public.platform_settings (key, value, description)
values
  ('payout_hold_hours', to_jsonb(24), 'Minimum settlement age in hours before an automated payout may run.'),
  ('payout_max_attempts', to_jsonb(3), 'Failed payout attempts per settlement before it is parked for admin review.')
on conflict (key) do nothing;

-- 3) Single auditable eligibility function for the pay-run. Invariants live here, not in the
--    Nest job. Returns settlement ids ready for an automated transfer.
--    SECURITY DEFINER + fixed search_path: the payout tables are RLS-locked; the privileged
--    app role already bypasses RLS, and this keeps behaviour identical if ever called otherwise.
create or replace function public.select_payable_settlements(
  p_hold_hours integer,
  p_max_attempts integer,
  p_limit integer
)
returns table (settlement_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.settlements s
  where s.payable_kobo > 0
    and s.status not in ('paid', 'cancelled')
    and s.created_at <= now() - make_interval(hours => p_hold_hours)
    and exists (
      select 1 from public.vendor_payout_accounts vpa
      where vpa.vendor_id = s.vendor_id
        and vpa.active
        and vpa.paystack_recipient_code is not null
        and vpa.admin_review_status = 'approved'
      union all
      select 1 from public.rider_payout_accounts rpa
      where rpa.rider_id = s.rider_id
        and rpa.active
        and rpa.paystack_recipient_code is not null
        and rpa.admin_review_status = 'approved'
    )
    and not exists (
      select 1 from public.payout_transfers pt
      where pt.settlement_id = s.id
        and pt.status in ('pending', 'success')
    )
    and (
      select count(*) from public.payout_transfers pt
      where pt.settlement_id = s.id
        and pt.status = 'failed'
    ) < p_max_attempts
  order by s.created_at
  limit p_limit;
$$;

comment on function public.select_payable_settlements(integer, integer, integer) is 'Selects settlement ids eligible for an automated Paystack payout: payable, past the hold period, beneficiary account approved with a recipient code, no in-flight/successful transfer, and under the failed-attempt cap.';

commit;
