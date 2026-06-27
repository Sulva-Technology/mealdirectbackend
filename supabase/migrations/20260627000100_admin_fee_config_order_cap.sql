begin;

-- Operator-managed pricing controls:
--   * vendors.service_fee_kobo  — per-vendor takeaway/packaging fee override (null → global default).
--   * campuses.max_service_fee_kobo — admin-set ceiling a vendor's service fee may not exceed.
--   * create_pending_order_and_reserve_inventory now rejects orders whose total exceeds a
--     configurable maximum (default ₦2490 = 249000 kobo), passed from the API config.
--
-- Delivery fee stays per-zone (campus_zones.delivery_fee_kobo) and the 75/75 rider/platform
-- split is unchanged; only the admin endpoint to edit the zone fee is new (no schema change there).

alter table public.vendors
  add column if not exists service_fee_kobo integer
  check (service_fee_kobo is null or service_fee_kobo >= 0);

comment on column public.vendors.service_fee_kobo is 'Per-vendor takeaway/packaging fee in kobo. NULL falls back to the global SERVICE_FEE_KOBO default. Bounded by campuses.max_service_fee_kobo.';

alter table public.campuses
  add column if not exists max_service_fee_kobo integer not null default 20000
  check (max_service_fee_kobo >= 0);

comment on column public.campuses.max_service_fee_kobo is 'Ceiling (kobo) a vendor on this campus may set for its takeaway/packaging service fee.';

-- Recreate create_pending_order_and_reserve_inventory: identical to
-- 20260625000400_order_service_fee.sql except it accepts p_max_order_total_kobo and rejects
-- orders whose computed total exceeds it.
drop function if exists public.create_pending_order_and_reserve_inventory(
  uuid, uuid, uuid, date, uuid, uuid, public.delivery_mode, jsonb, text, text, text, text, integer
);

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
  p_max_order_total_kobo integer default 249000
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
    select menu_item_id::uuid, quantity::integer
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer)
  loop
    if v_item.quantity <= 0 then
      raise exception 'item quantity must be positive' using errcode = '23514';
    end if;

    select mi.name, mi.price_kobo, ut.code as unit_code, ut.counts_toward_spoon_limit
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

  if p_max_order_total_kobo is not null and v_total > p_max_order_total_kobo then
    raise exception 'order total exceeds the maximum allowed amount' using errcode = '23514';
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
    select menu_item_id::uuid, quantity::integer, customization
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer, customization jsonb)
  loop
    select mi.name, mi.price_kobo, ut.code as unit_code
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
      customization
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
      end
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

comment on function public.create_pending_order_and_reserve_inventory(uuid, uuid, uuid, date, uuid, uuid, public.delivery_mode, jsonb, text, text, text, text, integer, integer) is 'Creates a pending-payment order, reserves inventory under row locks, enforces cutoff/spoon/max-total limits, applies the zone delivery fee, flat per-order service fee, and an optional promotion code, persists per-item customization and order special instructions, and records idempotency.';

commit;
