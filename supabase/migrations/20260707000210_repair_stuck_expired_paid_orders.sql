begin;

-- One-off repair for orders the pre-fix race left in a broken state: the customer's payment was
-- captured (payments.status = 'successful') but the order is still `expired`, because the old
-- mark_verified_payment_successful only transitioned orders that were still `pending_payment`.
--
-- The forward fix (20260707000100) cannot rescue these: their payment is already `successful`,
-- so the function's idempotency guard short-circuits before recovery. This heals them directly,
-- mirroring the new `expired -> paid` recovery branch. It is idempotent: once an order is paid it
-- no longer matches the selection, so re-running is a no-op.

do $$
declare
  r record;
begin
  for r in
    select distinct o.id
    from public.orders o
    join public.payments p on p.order_id = o.id
    where o.order_status = 'expired'
      and p.status = 'successful'
  loop
    -- Reservation was already released by release_expired_reservations, so only book the sale.
    -- Bump quantity_adjusted by any capacity shortfall so the capacity check still holds when the
    -- freed slot was resold in the meantime — the captured payment is honoured regardless.
    update public.menu_item_inventory inv
    set quantity_sold = inv.quantity_sold + oi.quantity,
        quantity_adjusted = inv.quantity_adjusted + greatest(
          0,
          (inv.quantity_reserved + inv.quantity_sold + oi.quantity)
            - (inv.quantity_total + inv.quantity_adjusted)
        ),
        version = inv.version + 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.order_id = r.id
      and inv.menu_item_id = oi.menu_item_id
      and inv.service_date = o.service_date
      and inv.delivery_slot_id = o.delivery_slot_id;

    update public.orders
    set order_status = 'paid',
        paid_at = coalesce(paid_at, now()),
        cancelled_at = null,
        cancellation_reason = null
    where id = r.id;

    insert into public.order_status_history (order_id, from_status, to_status, reason)
    values (r.id, 'expired', 'paid', 'one-off repair: payment captured but order expired (pre-fix race)');

    perform public.add_paid_order_to_batch(r.id);

    insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values ('payment.successful', 'order', r.id, jsonb_build_object('repair', true, 'order_id', r.id::text));
  end loop;
end $$;

commit;
