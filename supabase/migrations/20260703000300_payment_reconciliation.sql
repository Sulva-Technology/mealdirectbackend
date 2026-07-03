begin;

-- Reconciliation issue taxonomy. Covers the seven finance-ops discrepancy classes
-- the admin dashboard must surface between local state and Paystack.
create type public.payment_reconciliation_issue_type as enum (
  'initialized_unconfirmed',   -- payment initialized/pending, never confirmed
  'paid_order_pending',        -- payment successful but order still pending_payment
  'webhook_processing_failed', -- a signed webhook could not be applied
  'provider_success_not_local',-- Paystack reports success with no local payment
  'duplicate_success',         -- more than one successful payment for an order
  'amount_mismatch',           -- provider amount != expected amount
  'currency_mismatch',         -- provider currency != payment currency
  'refund_stuck'               -- refund stuck in a non-terminal state
);

create type public.payment_reconciliation_issue_status as enum (
  'open',
  'investigating',
  'resolved',
  'ignored'
);

create type public.payment_reconciliation_severity as enum (
  'info',
  'warning',
  'critical'
);

-- One row per distinct discrepancy. `dedup_key` collapses repeat detections of the
-- same problem so a re-scan updates last_seen instead of piling up duplicates.
create table public.payment_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  dedup_key text not null unique,
  issue_type public.payment_reconciliation_issue_type not null,
  status public.payment_reconciliation_issue_status not null default 'open',
  severity public.payment_reconciliation_severity not null default 'warning',
  payment_id uuid references public.payments(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  refund_id uuid references public.refunds(id) on delete set null,
  campus_id uuid references public.campuses(id) on delete set null,
  provider_reference text,
  detail jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_reconciliation_issues_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.payment_reconciliation_issues is 'Finance-ops discrepancies between local payment state and Paystack, deduplicated by dedup_key.';

create index payment_reconciliation_issues_status_idx
  on public.payment_reconciliation_issues (status, severity, last_detected_at desc);
create index payment_reconciliation_issues_campus_idx
  on public.payment_reconciliation_issues (campus_id, last_detected_at desc);
create index payment_reconciliation_issues_payment_idx
  on public.payment_reconciliation_issues (payment_id);

create trigger payment_reconciliation_issues_set_updated_at
before update on public.payment_reconciliation_issues
for each row execute function public.set_updated_at();

-- Append-only investigation notes attached to an issue.
create table public.payment_reconciliation_notes (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.payment_reconciliation_issues(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint payment_reconciliation_notes_body_present check (length(btrim(body)) > 0)
);

create index payment_reconciliation_notes_issue_idx
  on public.payment_reconciliation_notes (issue_id, created_at);

comment on table public.payment_reconciliation_notes is 'Append-only admin investigation notes for reconciliation issues.';

-- Sensitive finance data: keep private like other payout/finance tables. RLS is enabled
-- with no anon/authenticated grants or policies, so only the privileged application role
-- (which bypasses RLS) can read or write these rows.
alter table public.payment_reconciliation_issues enable row level security;
alter table public.payment_reconciliation_notes enable row level security;

-- Idempotent upsert used by both the webhook path and the scan job. Re-detecting an
-- existing issue refreshes last_detected_at + detail without clobbering an admin's
-- review decision (a resolved/ignored issue stays resolved/ignored).
create or replace function public.upsert_payment_reconciliation_issue(
  p_dedup_key text,
  p_issue_type public.payment_reconciliation_issue_type,
  p_severity public.payment_reconciliation_severity,
  p_payment_id uuid,
  p_order_id uuid,
  p_provider_reference text,
  p_detail jsonb default '{}'::jsonb,
  p_refund_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_id uuid;
begin
  select o.campus_id into v_campus_id
  from public.orders o
  where o.id = coalesce(
    p_order_id,
    (select pm.order_id from public.payments pm where pm.id = p_payment_id)
  );

  insert into public.payment_reconciliation_issues (
    dedup_key, issue_type, severity, payment_id, order_id, refund_id,
    campus_id, provider_reference, detail
  )
  values (
    p_dedup_key, p_issue_type, p_severity, p_payment_id, p_order_id, p_refund_id,
    v_campus_id, p_provider_reference, coalesce(p_detail, '{}'::jsonb)
  )
  on conflict (dedup_key) do update
    set last_detected_at = now(),
        severity = excluded.severity,
        detail = excluded.detail
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_payment_reconciliation_issue(text, public.payment_reconciliation_issue_type, public.payment_reconciliation_severity, uuid, uuid, text, jsonb, uuid) is 'Idempotently records a reconciliation issue; re-detection refreshes last_detected_at without overriding admin review state.';

-- Scan the local database for the discrepancy classes derivable without calling Paystack.
-- Event-time classes (webhook_processing_failed, provider_success_not_local, currency_mismatch)
-- are inserted by the webhook path and are not recomputed here.
create or replace function public.scan_payment_reconciliation(
  p_stale_seconds integer default 900,
  p_refund_stale_seconds integer default 3600
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  -- initialized_unconfirmed: still pending long after initialization.
  for r in
    select p.id as payment_id, p.order_id, p.provider_reference, p.expected_amount_kobo
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status in ('initialized', 'pending')
      and o.order_status = 'pending_payment'
      and p.created_at < now() - make_interval(secs => p_stale_seconds)
  loop
    perform public.upsert_payment_reconciliation_issue(
      'initialized_unconfirmed:' || r.payment_id::text,
      'initialized_unconfirmed', 'warning', r.payment_id, r.order_id, r.provider_reference,
      jsonb_build_object('expectedAmountKobo', r.expected_amount_kobo)
    );
    v_count := v_count + 1;
  end loop;

  -- paid_order_pending: payment confirmed but order never moved off pending_payment.
  for r in
    select p.id as payment_id, p.order_id, p.provider_reference
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'successful'
      and o.order_status = 'pending_payment'
  loop
    perform public.upsert_payment_reconciliation_issue(
      'paid_order_pending:' || r.payment_id::text,
      'paid_order_pending', 'critical', r.payment_id, r.order_id, r.provider_reference,
      '{}'::jsonb
    );
    v_count := v_count + 1;
  end loop;

  -- duplicate_success: more than one successful payment for the same order.
  for r in
    select o.id as order_id, count(*) as success_count
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'successful'
    group by o.id
    having count(*) > 1
  loop
    perform public.upsert_payment_reconciliation_issue(
      'duplicate_success:' || r.order_id::text,
      'duplicate_success', 'critical', null, r.order_id, null,
      jsonb_build_object('successfulPaymentCount', r.success_count)
    );
    v_count := v_count + 1;
  end loop;

  -- amount_mismatch: confirmed payment whose paid amount drifted from expected.
  for r in
    select p.id as payment_id, p.order_id, p.provider_reference,
           p.expected_amount_kobo, p.paid_amount_kobo
    from public.payments p
    where p.status = 'successful'
      and p.paid_amount_kobo is not null
      and p.paid_amount_kobo <> p.expected_amount_kobo
  loop
    perform public.upsert_payment_reconciliation_issue(
      'amount_mismatch:' || r.payment_id::text,
      'amount_mismatch', 'critical', r.payment_id, r.order_id, r.provider_reference,
      jsonb_build_object('expectedAmountKobo', r.expected_amount_kobo,
                         'paidAmountKobo', r.paid_amount_kobo)
    );
    v_count := v_count + 1;
  end loop;

  -- refund_stuck: refund lingering in a non-terminal state.
  for r in
    select rf.id as refund_id, rf.payment_id, rf.order_id, rf.status::text as refund_status
    from public.refunds rf
    where rf.status in ('requested', 'approved', 'processing')
      and rf.requested_at < now() - make_interval(secs => p_refund_stale_seconds)
  loop
    perform public.upsert_payment_reconciliation_issue(
      'refund_stuck:' || r.refund_id::text,
      'refund_stuck', 'warning', r.payment_id, r.order_id, null,
      jsonb_build_object('refundStatus', r.refund_status),
      r.refund_id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.scan_payment_reconciliation(integer, integer) is 'Detects local reconciliation discrepancies (stale init, paid-but-pending, duplicate success, amount drift, stuck refunds) and upserts issues.';

commit;
