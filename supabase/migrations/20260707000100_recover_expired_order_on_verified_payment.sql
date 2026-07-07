begin;

-- Fixes: orders stuck in `expired` even though Paystack captured the money.
--
-- Root cause: `release_expired_reservations()` flips a pending order to `expired` once its
-- (short, <=15 min) reservation window passes. If the provider success is confirmed *after*
-- that — via the webhook or the every-2-min reconcile sweep — the previous version of
-- `mark_verified_payment_successful` marked the PAYMENT successful unconditionally but only
-- transitioned the order `where order_status = 'pending_payment'`. For an already-expired
-- order that guard matched zero rows, so the order stayed `expired` while a bogus
-- `pending_payment -> paid` history row was still inserted and the reservation was released a
-- second time.
--
-- This rewrite branches on the order's actual status:
--   * pending_payment -> convert the still-held reservation into a sale (unchanged behaviour).
--   * expired         -> auto-recover: the reservation was already released, so only book the
--                        sale, bumping quantity_adjusted by any shortfall so the capacity check
--                        still holds when the freed slot was resold in the gap. The captured
--                        payment is always honoured.
--   * anything else    -> do not fabricate a transition; emit `payment.successful_unresolved`
--                        so finance can reconcile/refund (money captured, order not open).

create or replace function public.mark_verified_payment_successful(
  p_provider public.payment_provider,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_paid_amount_kobo integer,
  p_provider_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_from_status public.order_status;
begin
  select * into v_payment
  from public.payments
  where provider = p_provider
    and provider_reference = p_provider_reference
  for update;

  if not found then
    raise exception 'payment reference % not found', p_provider_reference using errcode = 'P0002';
  end if;

  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if v_payment.status = 'successful' then
    return v_order.id;
  end if;

  if p_paid_amount_kobo <> v_payment.expected_amount_kobo then
    raise exception 'paid amount does not match expected amount' using errcode = '23514';
  end if;

  v_from_status := v_order.order_status;

  -- Money is real, but only awaiting-payment or expired orders can be resolved into a sale.
  -- Cancelled/refunded/already-progressed orders are left for finance review instead of being
  -- silently flipped to paid.
  if v_from_status not in ('pending_payment', 'expired') then
    insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values (
      'payment.successful_unresolved',
      'order',
      v_order.id,
      jsonb_build_object(
        'provider_reference', p_provider_reference,
        'order_status', v_from_status::text
      )
    );
    return v_order.id;
  end if;

  update public.payments
  set status = 'successful',
      provider_transaction_id = p_provider_transaction_id,
      paid_amount_kobo = p_paid_amount_kobo,
      verified_at = now(),
      paid_at = now(),
      provider_payload = coalesce(p_provider_payload, '{}'::jsonb)
  where id = v_payment.id;

  if v_from_status = 'pending_payment' then
    -- Reservation still held: convert reserved units into sold.
    update public.menu_item_inventory inv
    set quantity_reserved = inv.quantity_reserved - oi.quantity,
        quantity_sold = inv.quantity_sold + oi.quantity,
        version = inv.version + 1
    from public.order_items oi
    where oi.order_id = v_order.id
      and inv.menu_item_id = oi.menu_item_id
      and inv.service_date = v_order.service_date
      and inv.delivery_slot_id = v_order.delivery_slot_id;
  else
    -- Recovery: release_expired_reservations already released this order's reservation, so only
    -- book the sale. Raise quantity_adjusted by any capacity shortfall so
    -- (quantity_reserved + quantity_sold <= quantity_total + quantity_adjusted) still holds even
    -- when the freed capacity was resold — the confirmed payment is honoured regardless.
    update public.menu_item_inventory inv
    set quantity_sold = inv.quantity_sold + oi.quantity,
        quantity_adjusted = inv.quantity_adjusted + greatest(
          0,
          (inv.quantity_reserved + inv.quantity_sold + oi.quantity)
            - (inv.quantity_total + inv.quantity_adjusted)
        ),
        version = inv.version + 1
    from public.order_items oi
    where oi.order_id = v_order.id
      and inv.menu_item_id = oi.menu_item_id
      and inv.service_date = v_order.service_date
      and inv.delivery_slot_id = v_order.delivery_slot_id;
  end if;

  update public.orders
  set order_status = 'paid',
      paid_at = now(),
      cancelled_at = null,
      cancellation_reason = null
  where id = v_order.id;

  insert into public.order_status_history (order_id, from_status, to_status, reason)
  values (
    v_order.id,
    v_from_status,
    'paid',
    case
      when v_from_status = 'expired'
        then 'payment confirmed after reservation expiry — auto-recovered'
      else 'verified provider payment'
    end
  );

  perform public.add_paid_order_to_batch(v_order.id);

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values ('payment.successful', 'order', v_order.id, jsonb_build_object('provider_reference', p_provider_reference));

  return v_order.id;
end;
$$;

comment on function public.mark_verified_payment_successful(public.payment_provider, text, text, integer, jsonb) is 'Marks a provider payment successful and resolves the order: converts reservations to sold for pending orders, auto-recovers reservation-expired orders to paid (honouring the capture), and flags other statuses for finance review.';

commit;
