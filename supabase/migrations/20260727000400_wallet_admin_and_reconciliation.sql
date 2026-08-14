begin;

-- Administrator creating or destroying balance. This is the only path that writes a ledger
-- entry with no provider reference, so it demands a reason and records the acting admin.
-- The API layer additionally gates it behind @RequirePermission('wallets:manage') and
-- writes an audit_logs row.
create or replace function public.admin_adjust_wallet(
  p_wallet_id uuid,
  p_amount_kobo integer,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'a reason is required for a wallet adjustment' using errcode = '23514';
  end if;

  return public.append_wallet_ledger_entry(
    p_wallet_id,
    'adjustment',
    p_amount_kobo,
    null,
    null,
    p_actor_user_id,
    v_reason,
    jsonb_build_object('source', 'admin_adjustment')
  );
end;
$$;

comment on function public.admin_adjust_wallet(uuid, integer, text, uuid) is 'Admin-created signed wallet adjustment. Requires a non-blank reason and records the acting admin on the ledger entry.';

create or replace function public.set_wallet_status(
  p_wallet_id uuid,
  p_status public.wallet_status
)
returns public.wallet_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.wallet_status;
begin
  update public.wallets
  set status = p_status
  where id = p_wallet_id
  returning status into v_status;

  if not found then
    raise exception 'wallet % not found', p_wallet_id using errcode = 'P0002';
  end if;

  return v_status;
end;
$$;

comment on function public.set_wallet_status(uuid, public.wallet_status) is 'Freezes or unfreezes a wallet. A frozen wallet cannot pay for orders but still receives credits.';

-- Refunds always land in the wallet: instant, no Paystack refund fee, no 3–10 day wait.
-- The card-refund path in refunds.service.ts stays available to admins for disputes.
create or replace function public.refund_order_to_wallet(
  p_order_id uuid,
  p_amount_kobo integer,
  p_reason text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_wallet_id uuid;
begin
  select customer_id into v_customer_id
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'refund amount must be positive' using errcode = '23514';
  end if;

  v_wallet_id := public.ensure_customer_wallet(v_customer_id);

  return public.append_wallet_ledger_entry(
    v_wallet_id,
    'order_refund',
    p_amount_kobo,
    p_order_id,
    null,
    p_actor_user_id,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'order refunded to wallet'),
    jsonb_build_object('source', 'order_refund')
  );
end;
$$;

comment on function public.refund_order_to_wallet(uuid, integer, text, uuid) is 'Credits a refund straight to the order customer wallet and links the ledger entry to the order.';

-- Nightly invariant: the cached balance must equal the sum of the ledger. Any mismatch is
-- a critical finance issue — it means a balance moved outside append_wallet_ledger_entry.
create or replace function public.detect_wallet_balance_drift()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_detected integer := 0;
begin
  for v_row in
    select w.id as wallet_id,
           w.user_id,
           w.balance_kobo,
           coalesce(sum(e.amount_kobo), 0)::integer as ledger_total
    from public.wallets w
    left join public.wallet_ledger_entries e on e.wallet_id = w.id
    group by w.id, w.user_id, w.balance_kobo
    having w.balance_kobo <> coalesce(sum(e.amount_kobo), 0)::integer
  loop
    perform public.upsert_payment_reconciliation_issue(
      'wallet_balance_drift:' || v_row.wallet_id::text,
      'wallet_balance_drift'::public.payment_reconciliation_issue_type,
      'critical'::public.payment_reconciliation_severity,
      null,
      null,
      null,
      jsonb_build_object(
        'walletId', v_row.wallet_id,
        'userId', v_row.user_id,
        'cachedBalanceKobo', v_row.balance_kobo,
        'ledgerTotalKobo', v_row.ledger_total,
        'driftKobo', v_row.balance_kobo - v_row.ledger_total
      )
    );
    v_detected := v_detected + 1;
  end loop;

  return v_detected;
end;
$$;

comment on function public.detect_wallet_balance_drift() is 'Asserts wallets.balance_kobo equals the sum of that wallet ledger; files a critical wallet_balance_drift reconciliation issue per mismatch and returns the count.';

commit;
