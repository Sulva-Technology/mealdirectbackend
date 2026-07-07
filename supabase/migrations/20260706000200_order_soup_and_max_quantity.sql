begin;

-- Recreate create_pending_order_and_reserve_inventory: identical to
-- 20260705000100_large_order_surcharge.sql except it now, per item:
--   * enforces the unit type's max_quantity (single-portion items like pepper soup cap at 1),
--   * requires exactly one valid, active, vendor-owned soup when the menu item requires_soup,
--   * persists the chosen soup into order_items.soup_option_id.
-- The soup pick rides inside p_items jsonb (soup_option_id per line), so the function
-- signature is unchanged — no new positional argument.

create or replace function public.create_pending_order_and_reserve_inventory(
  p_customer_id uuid,
  p_campus_id uuid,
  p_vendor_id uuid,
  p_service_date date,
  p_delivery_slot_id uuid,
  p_location_id uuid,
  p_delivery_mode public.delivery_mode,
  p_items jsonb,
  p_idempotency_key text,
  p_request_hash text default null,
  p_promotion_code text default null,
  p_special_instructions text default null,
  p_service_fee_kobo integer default 0,
  p_max_order_total_kobo integer default 249000,
  p_large_order_surcharge_bps integer default 150,
  p_large_order_surcharge_flat_kobo integer default 10000,
  p_accept_large_order boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_resource_id uuid;
  v_location_zone_id uuid;
  v_delivery_fee integer;
  v_service_fee integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_food_subtotal integer := 0;
  v_spoon_units integer := 0;
  v_delivery_mode public.delivery_mode;
  v_item record;
  v_catalog record;
  v_inventory record;
  v_remaining integer;
  v_promo record;
  v_discount integer := 0;
  v_total integer;
  v_surcharge integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item' using errcode = '23514';
  end if;

  v_service_fee := greatest(coalesce(p_service_fee_kobo, 0), 0);

  select resource_id
  into v_existing_resource_id
  from public.idempotency_keys
  where actor_user_id = p_customer_id
    and operation = 'create_order'
    and idempotency_key = p_idempotency_key
    and expires_at > now();

  if v_existing_resource_id is not null then
    return v_existing_resource_id;
  end if;

  insert into public.idempotency_keys (
    actor_user_id,
    operation,
    idempotency_key,
    request_hash,
    expires_at
  )
  values (
    p_customer_id,
    'create_order',
    p_idempotency_key,
    p_request_hash,
    now() + interval '24 hours'
  )
  on conflict (actor_user_id, operation, idempotency_key) do nothing;

  select cl.zone_id, coalesce(cz.delivery_fee_kobo, 15000)
  into v_location_zone_id, v_delivery_fee
  from public.campus_locations cl
  join public.campus_zones cz on cz.id = cl.zone_id
  where cl.id = p_location_id
    and cl.campus_id = p_campus_id
    and cl.active;

  if v_location_zone_id is null then
    raise exception 'delivery location is not active for campus' using errcode = '23514';
  end if;

  if now() >= public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id) then
    raise exception 'orders are closed for this delivery slot' using errcode = '23514';
  end if;

  select coalesce(p_delivery_mode, v.default_delivery_mode)
  into v_delivery_mode
  from public.vendors v
  where v.id = p_vendor_id
    and v.campus_id = p_campus_id
    and v.status = 'approved'
    and v.active;

  if v_delivery_mode is null then
    raise exception 'vendor is not active for campus' using errcode = '23514';
  end if;

  for v_item in
    select menu_item_id::uuid, quantity::integer, soup_option_id::uuid
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer, soup_option_id uuid)
  loop
    if v_item.quantity <= 0 then
      raise exception 'item quantity must be positive' using errcode = '23514';
    end if;

    select mi.name,
           mi.price_kobo,
           mi.requires_soup,
           ut.code as unit_code,
           ut.counts_toward_spoon_limit,
           ut.max_quantity
    into v_catalog
    from public.menu_items mi
    join public.unit_types ut on ut.id = mi.unit_type_id
    where mi.id = v_item.menu_item_id
      and mi.vendor_id = p_vendor_id
      and mi.active
      and ut.active;

    if not found then
      raise exception 'menu item % is not active for vendor', v_item.menu_item_id using errcode = '23514';
    end if;

    if v_catalog.max_quantity is not null and v_item.quantity > v_catalog.max_quantity then
      raise exception 'menu item % exceeds its maximum quantity of % per order', v_item.menu_item_id, v_catalog.max_quantity using errcode = '23514';
    end if;

    -- Soup pick: exactly one, required, must be an active soup owned by this vendor.
    if v_catalog.requires_soup then
      if v_item.soup_option_id is null then
        raise exception 'menu item % requires a soup selection', v_item.menu_item_id using errcode = '23514';
      end if;
      if not exists (
        select 1
        from public.vendor_soup_options so
        where so.id = v_item.soup_option_id
          and so.vendor_id = p_vendor_id
          and so.active
      ) then
        raise exception 'soup selection % is not valid for menu item %', v_item.soup_option_id, v_item.menu_item_id using errcode = '23514';
      end if;
    end if;

    if not exists (
      select 1
      from public.available_menu_items(p_campus_id, p_service_date, p_delivery_slot_id) ami
      where ami.menu_item_id = v_item.menu_item_id
        and ami.vendor_id = p_vendor_id
    ) then
      raise exception 'menu item % is not orderable for this date and slot', v_item.menu_item_id using errcode = '23514';
    end if;

    select inv.id,
           inv.quantity_total,
           inv.quantity_adjusted,
           inv.quantity_reserved,
           inv.quantity_sold,
           inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold as remaining_quantity
    into v_inventory
    from public.menu_item_inventory inv
    where inv.menu_item_id = v_item.menu_item_id
      and inv.service_date = p_service_date
      and inv.delivery_slot_id = p_delivery_slot_id
      and inv.active
    for update;

    if not found then
      raise exception 'inventory missing for menu item %', v_item.menu_item_id using errcode = '23514';
    end if;

    v_remaining := v_inventory.remaining_quantity;
    if v_remaining < v_item.quantity then
      raise exception 'insufficient inventory for menu item %', v_item.menu_item_id using errcode = '23514';
    end if;

    update public.menu_item_inventory
    set quantity_reserved = quantity_reserved + v_item.quantity,
        version = version + 1
    where id = v_inventory.id;

    v_food_subtotal := v_food_subtotal + (v_catalog.price_kobo * v_item.quantity);
    if v_catalog.counts_toward_spoon_limit then
      v_spoon_units := v_spoon_units + v_item.quantity;
    end if;
  end loop;

  if v_spoon_units > 3 then
    raise exception 'one takeaway package cannot contain more than three spoon-based units' using errcode = '23514';
  end if;

  if p_promotion_code is not null then
    select * into v_promo
    from public.promotions
    where code = p_promotion_code
      and active
    for update;

    if not found then
      raise exception 'promotion code is not valid' using errcode = '23514';
    end if;

    if now() < v_promo.starts_at or (v_promo.ends_at is not null and now() > v_promo.ends_at) then
      raise exception 'promotion code is not currently active' using errcode = '23514';
    end if;

    if v_food_subtotal < v_promo.min_order_kobo then
      raise exception 'order subtotal is below the promotion minimum' using errcode = '23514';
    end if;

    if (select count(*) from public.promotion_redemptions where promotion_id = v_promo.id and user_id = p_customer_id) >= v_promo.per_user_limit then
      raise exception 'promotion code usage limit reached for this user' using errcode = '23514';
    end if;

    if v_promo.total_usage_limit is not null
       and (select count(*) from public.promotion_redemptions where promotion_id = v_promo.id) >= v_promo.total_usage_limit then
      raise exception 'promotion code usage limit reached' using errcode = '23514';
    end if;

    if v_promo.discount_type = 'fixed' then
      v_discount := v_promo.discount_value;
    else
      v_discount := floor((v_food_subtotal * v_promo.discount_value) / 100.0);
      if v_promo.max_discount_kobo is not null then
        v_discount := least(v_discount, v_promo.max_discount_kobo);
      end if;
    end if;

    v_discount := least(v_discount, v_food_subtotal);
  end if;

  v_total := v_food_subtotal + v_delivery_fee + v_service_fee - v_discount;

  -- Large-order surcharge: over the standard cap, require opt-in and add the surcharge on top.
  if p_max_order_total_kobo is not null and v_total > p_max_order_total_kobo then
    if not coalesce(p_accept_large_order, false) then
      raise exception 'order total exceeds the standard maximum; large-order surcharge not accepted' using errcode = '23514';
    end if;

    v_surcharge := (
      round(v_total::numeric * coalesce(p_large_order_surcharge_bps, 0)::numeric / 10000.0)
      + greatest(coalesce(p_large_order_surcharge_flat_kobo, 0), 0)
    )::integer;
    v_total := v_total + v_surcharge;
  end if;

  insert into public.orders (
    customer_id,
    campus_id,
    vendor_id,
    service_date,
    delivery_slot_id,
    location_id,
    zone_id,
    delivery_mode,
    food_subtotal_kobo,
    delivery_fee_kobo,
    service_fee_kobo,
    discount_kobo,
    large_order_surcharge_kobo,
    total_kobo,
    special_instructions,
    inventory_reservation_expires_at
  )
  values (
    p_customer_id,
    p_campus_id,
    p_vendor_id,
    p_service_date,
    p_delivery_slot_id,
    p_location_id,
    v_location_zone_id,
    v_delivery_mode,
    v_food_subtotal,
    v_delivery_fee,
    v_service_fee,
    v_discount,
    v_surcharge,
    v_total,
    nullif(btrim(coalesce(p_special_instructions, '')), ''),
    least(public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id), now() + interval '15 minutes')
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Only reference v_promo (assigned) when a promo code was supplied.
  if p_promotion_code is not null then
    insert into public.promotion_redemptions (promotion_id, user_id, order_id, discount_kobo)
    values (v_promo.id, p_customer_id, v_order_id, v_discount);
  end if;

  for v_item in
    select menu_item_id::uuid, quantity::integer, customization, soup_option_id::uuid
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer, customization jsonb, soup_option_id uuid)
  loop
    select mi.name, mi.price_kobo, mi.requires_soup, ut.code as unit_code
    into v_catalog
    from public.menu_items mi
    join public.unit_types ut on ut.id = mi.unit_type_id
    where mi.id = v_item.menu_item_id;

    insert into public.order_items (
      order_id,
      menu_item_id,
      item_name,
      unit_type,
      unit_price_kobo,
      quantity,
      line_total_kobo,
      customization,
      soup_option_id
    )
    values (
      v_order_id,
      v_item.menu_item_id,
      v_catalog.name,
      v_catalog.unit_code,
      v_catalog.price_kobo,
      v_item.quantity,
      v_catalog.price_kobo * v_item.quantity,
      case
        when v_item.customization is null or jsonb_typeof(v_item.customization) <> 'object'
          then '{}'::jsonb
        else v_item.customization
      end,
      case when v_catalog.requires_soup then v_item.soup_option_id else null end
    );
  end loop;

  insert into public.order_status_history (order_id, from_status, to_status, actor_user_id, reason)
  values (v_order_id, null, 'pending_payment', p_customer_id, 'order created and inventory reserved');

  insert into public.payments (order_id, provider, provider_reference, status, expected_amount_kobo)
  select v_order_id, 'paystack', v_order_number, 'initialized', total_kobo
  from public.orders
  where id = v_order_id;

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values ('order.pending_payment_created', 'order', v_order_id, jsonb_build_object('order_number', v_order_number));

  update public.idempotency_keys
  set response_status = 201,
      response_body = jsonb_build_object('order_id', v_order_id),
      resource_id = v_order_id
  where actor_user_id = p_customer_id
    and operation = 'create_order'
    and idempotency_key = p_idempotency_key;

  return v_order_id;
end;
$$;

comment on function public.create_pending_order_and_reserve_inventory(uuid, uuid, uuid, date, uuid, uuid, public.delivery_mode, jsonb, text, text, text, text, integer, integer, integer, integer, boolean) is 'Creates a pending-payment order, reserves inventory under row locks, enforces cutoff/spoon/per-unit-max-quantity limits and required soup selections, applies the zone delivery fee, flat per-order service fee, and an optional promotion code, and for totals above the standard cap requires customer opt-in and applies a large-order surcharge (bps + flat), persisting per-item customization, chosen soup, order special instructions, and the surcharge, and records idempotency.';

commit;
