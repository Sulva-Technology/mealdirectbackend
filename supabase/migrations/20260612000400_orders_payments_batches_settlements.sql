begin;

create type public.order_status as enum (
  'pending_payment',
  'paid',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'confirmed',
  'administratively_completed',
  'cancelled',
  'expired',
  'refunded'
);

create type public.payment_status as enum ('initialized', 'pending', 'successful', 'failed', 'abandoned', 'refunded');
create type public.payment_provider as enum ('paystack');
create type public.refund_status as enum ('requested', 'approved', 'processing', 'succeeded', 'failed', 'cancelled');
create type public.batch_status as enum ('open', 'closed', 'assigned', 'in_progress', 'completed', 'cancelled');
create type public.delivery_assignment_status as enum ('assigned', 'accepted', 'picked_up', 'completed', 'cancelled');
create type public.settlement_status as enum ('draft', 'approved', 'paid', 'cancelled');
create type public.escalation_status as enum ('open', 'investigating', 'resolved', 'rejected');
create type public.review_target_type as enum ('menu_item', 'vendor', 'delivery');
create type public.review_moderation_status as enum ('pending', 'approved', 'rejected');

create or replace function public.generate_order_number()
returns text
language sql
volatile
as $$
  select 'MD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

comment on function public.generate_order_number() is 'Generates immutable human-readable Meal Direct order numbers.';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null default public.generate_order_number(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  service_date date not null,
  delivery_slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  location_id uuid not null references public.campus_locations(id) on delete restrict,
  zone_id uuid not null references public.campus_zones(id) on delete restrict,
  order_status public.order_status not null default 'pending_payment',
  delivery_mode public.delivery_mode not null,
  food_subtotal_kobo integer not null,
  delivery_fee_kobo integer not null default 15000,
  platform_delivery_share_kobo integer not null default 7500,
  fulfiller_delivery_share_kobo integer not null default 7500,
  discount_kobo integer not null default 0,
  total_kobo integer not null,
  currency char(3) not null default 'NGN',
  inventory_reservation_expires_at timestamptz,
  paid_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_order_number_unique unique (order_number),
  constraint orders_money_non_negative check (
    food_subtotal_kobo >= 0
    and delivery_fee_kobo = 15000
    and platform_delivery_share_kobo = 7500
    and fulfiller_delivery_share_kobo = 7500
    and discount_kobo >= 0
    and total_kobo >= 0
  ),
  constraint orders_total_formula check (total_kobo = food_subtotal_kobo + delivery_fee_kobo - discount_kobo),
  constraint orders_currency_ngn check (currency = 'NGN'),
  constraint orders_reservation_needed_for_pending check (
    order_status <> 'pending_payment' or inventory_reservation_expires_at is not null
  )
);

comment on table public.orders is 'One takeaway package order from one customer to one vendor for one campus date, slot, and location.';
comment on column public.orders.food_subtotal_kobo is 'Immutable order-time food subtotal in kobo.';
comment on column public.orders.platform_delivery_share_kobo is 'Meal Direct fixed delivery share per completed order during pilot.';
comment on column public.orders.fulfiller_delivery_share_kobo is 'Delivery fulfiller fixed share per completed order during pilot.';

create index orders_customer_created_idx on public.orders (customer_id, created_at desc);
create index orders_vendor_service_slot_idx on public.orders (vendor_id, service_date, delivery_slot_id, order_status);
create index orders_campus_service_slot_idx on public.orders (campus_id, service_date, delivery_slot_id, order_status);
create index orders_zone_service_idx on public.orders (zone_id, service_date, delivery_slot_id);
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  item_name text not null,
  unit_type text not null,
  unit_price_kobo integer not null,
  quantity integer not null,
  line_total_kobo integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_price_non_negative check (unit_price_kobo >= 0),
  constraint order_items_line_total_formula check (line_total_kobo = unit_price_kobo * quantity)
);

comment on table public.order_items is 'Immutable order item snapshots used to preserve pricing and unit names after catalogue edits.';
comment on column public.order_items.unit_type is 'Snapshot of the unit type code at order time.';

create index order_items_order_idx on public.order_items (order_id);
create index order_items_menu_item_idx on public.order_items (menu_item_id);
create trigger order_items_set_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_status_history_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.order_status_history is 'Append-only order status transition history.';

create index order_status_history_order_created_idx on public.order_status_history (order_id, created_at desc);
create index order_status_history_request_idx on public.order_status_history (request_id) where request_id is not null;
create trigger order_status_history_prevent_update
before update or delete on public.order_status_history
for each row execute function public.prevent_update_delete();

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  operation text not null,
  idempotency_key text not null,
  request_hash text,
  response_status integer,
  response_body jsonb,
  resource_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint idempotency_keys_operation_not_blank check (length(btrim(operation)) > 0),
  constraint idempotency_keys_key_not_blank check (length(btrim(idempotency_key)) > 0),
  constraint idempotency_keys_unique unique (actor_user_id, operation, idempotency_key)
);

comment on table public.idempotency_keys is 'Idempotency records for order creation, payment processing, refunds, and background jobs.';

create index idempotency_keys_expires_idx on public.idempotency_keys (expires_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider public.payment_provider not null default 'paystack',
  provider_reference text not null,
  provider_transaction_id text,
  status public.payment_status not null default 'initialized',
  expected_amount_kobo integer not null,
  paid_amount_kobo integer,
  currency char(3) not null default 'NGN',
  channel text,
  initialized_at timestamptz not null default now(),
  verified_at timestamptz,
  paid_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amounts_non_negative check (
    expected_amount_kobo >= 0 and (paid_amount_kobo is null or paid_amount_kobo >= 0)
  ),
  constraint payments_currency_ngn check (currency = 'NGN'),
  constraint payments_provider_reference_unique unique (provider, provider_reference),
  constraint payments_payload_object check (jsonb_typeof(provider_payload) = 'object')
);

comment on table public.payments is 'Paystack payment attempts and verification snapshots. Sensitive provider data is excluded from payloads.';

create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status, created_at desc);
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null default 'paystack',
  event_fingerprint text not null,
  event_type text not null,
  provider_reference text,
  signature_valid boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  constraint payment_events_fingerprint_unique unique (provider, event_fingerprint),
  constraint payment_events_payload_object check (jsonb_typeof(payload) = 'object')
);

comment on table public.payment_events is 'Append-only webhook inbox for Paystack event deduplication and processing.';

create index payment_events_reference_idx on public.payment_events (provider, provider_reference);
create index payment_events_processed_idx on public.payment_events (processed_at) where processed_at is null;
create trigger payment_events_prevent_update
before update or delete on public.payment_events
for each row execute function public.prevent_update_delete();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider_refund_reference text,
  amount_kobo integer not null,
  reason_code text not null,
  reason_text text,
  status public.refund_status not null default 'requested',
  requested_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  constraint refunds_amount_positive check (amount_kobo > 0),
  constraint refunds_payload_object check (jsonb_typeof(provider_payload) = 'object')
);

comment on table public.refunds is 'Refund requests and Paystack refund snapshots.';

create index refunds_order_idx on public.refunds (order_id);
create index refunds_payment_idx on public.refunds (payment_id);
create index refunds_status_idx on public.refunds (status, requested_at desc);

create table public.delivery_batches (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  service_date date not null,
  delivery_slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  zone_id uuid not null references public.campus_zones(id) on delete restrict,
  batch_number text not null,
  status public.batch_status not null default 'open',
  delivery_mode public.delivery_mode not null,
  order_count integer not null default 0,
  delivery_earnings_kobo integer not null default 0,
  cutoff_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_batches_count_non_negative check (order_count >= 0),
  constraint delivery_batches_earnings_formula check (delivery_earnings_kobo = order_count * 7500),
  constraint delivery_batches_logical_unique unique (campus_id, vendor_id, service_date, delivery_slot_id, zone_id, delivery_mode),
  constraint delivery_batches_number_unique unique (batch_number)
);

comment on table public.delivery_batches is 'Dated operational delivery batches grouped by campus, vendor, slot, zone, and delivery fulfiller type.';

create index delivery_batches_campus_service_idx on public.delivery_batches (campus_id, service_date, delivery_slot_id, status);
create index delivery_batches_vendor_service_idx on public.delivery_batches (vendor_id, service_date, delivery_slot_id, status);
create trigger delivery_batches_set_updated_at
before update on public.delivery_batches
for each row execute function public.set_updated_at();

create table public.delivery_batch_orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.delivery_batches(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  sequence integer,
  added_at timestamptz not null default now(),
  constraint delivery_batch_orders_order_unique unique (order_id),
  constraint delivery_batch_orders_sequence_positive check (sequence is null or sequence > 0)
);

comment on table public.delivery_batch_orders is 'Associates each paid order with exactly one active delivery batch.';

create index delivery_batch_orders_batch_idx on public.delivery_batch_orders (batch_id, sequence, added_at);

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.delivery_batches(id) on delete restrict,
  rider_id uuid references public.riders(id) on delete restrict,
  vendor_id uuid references public.vendors(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  status public.delivery_assignment_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  completed_at timestamptz,
  constraint delivery_assignments_one_fulfiller check (
    ((rider_id is not null)::integer + (vendor_id is not null)::integer) = 1
  ),
  constraint delivery_assignments_batch_unique unique (batch_id)
);

comment on table public.delivery_assignments is 'Manual delivery fulfilment assignment for a batch, either a Meal Direct rider or the vendor.';

create index delivery_assignments_rider_status_idx on public.delivery_assignments (rider_id, status) where rider_id is not null;
create index delivery_assignments_vendor_status_idx on public.delivery_assignments (vendor_id, status) where vendor_id is not null;

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  vendor_id uuid references public.vendors(id) on delete restrict,
  rider_id uuid references public.riders(id) on delete restrict,
  settlement_date date not null,
  status public.settlement_status not null default 'draft',
  gross_food_amount_kobo integer not null default 0,
  delivery_earnings_kobo integer not null default 0,
  refunds_kobo integer not null default 0,
  adjustments_kobo integer not null default 0,
  payable_kobo integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlements_one_beneficiary check (
    ((vendor_id is not null)::integer + (rider_id is not null)::integer) = 1
  ),
  constraint settlements_amounts_non_negative check (
    gross_food_amount_kobo >= 0 and delivery_earnings_kobo >= 0 and refunds_kobo >= 0 and payable_kobo >= 0
  ),
  constraint settlements_payable_formula check (
    payable_kobo = gross_food_amount_kobo + delivery_earnings_kobo - refunds_kobo + adjustments_kobo
  )
);

comment on table public.settlements is 'Daily payable calculations for one vendor or one rider.';

create unique index settlements_vendor_date_unique on public.settlements (vendor_id, settlement_date) where vendor_id is not null;
create unique index settlements_rider_date_unique on public.settlements (rider_id, settlement_date) where rider_id is not null;
create index settlements_campus_date_idx on public.settlements (campus_id, settlement_date, status);
create trigger settlements_set_updated_at
before update on public.settlements
for each row execute function public.set_updated_at();

create table public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  line_type text not null,
  amount_kobo integer not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint settlement_lines_amount_non_zero check (amount_kobo <> 0),
  constraint settlement_lines_type_not_blank check (length(btrim(line_type)) > 0)
);

comment on table public.settlement_lines is 'Append-only settlement detail lines for order food, delivery earnings, refunds, and adjustments.';

create index settlement_lines_settlement_idx on public.settlement_lines (settlement_id, created_at);
create trigger settlement_lines_prevent_update
before update or delete on public.settlement_lines
for each row execute function public.prevent_update_delete();

create table public.delivery_confirmations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint delivery_confirmations_order_unique unique (order_id),
  constraint delivery_confirmations_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.delivery_confirmations is 'Customer confirmation that a delivered order was received.';

create index delivery_confirmations_customer_idx on public.delivery_confirmations (customer_id, confirmed_at desc);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  category text not null,
  description text not null,
  status public.escalation_status not null default 'open',
  assigned_admin_id uuid references public.profiles(id) on delete set null,
  resolution text,
  refund_id uuid references public.refunds(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint escalations_category_not_blank check (length(btrim(category)) > 0),
  constraint escalations_description_not_blank check (length(btrim(description)) > 0)
);

comment on table public.escalations is 'Customer escalations for undelivered, defective, or otherwise disputed orders.';

create index escalations_order_idx on public.escalations (order_id);
create index escalations_status_idx on public.escalations (status, opened_at desc);
create trigger escalations_set_updated_at
before update on public.escalations
for each row execute function public.set_updated_at();

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  menu_item_id uuid references public.menu_items(id) on delete restrict,
  vendor_id uuid references public.vendors(id) on delete restrict,
  delivery_batch_id uuid references public.delivery_batches(id) on delete restrict,
  food_rating integer,
  vendor_rating integer,
  delivery_rating integer,
  comment text,
  moderation_status public.review_moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_order_reviewer_unique unique (order_id, reviewer_id),
  constraint reviews_food_rating_range check (food_rating is null or food_rating between 1 and 5),
  constraint reviews_vendor_rating_range check (vendor_rating is null or vendor_rating between 1 and 5),
  constraint reviews_delivery_rating_range check (delivery_rating is null or delivery_rating between 1 and 5)
);

comment on table public.reviews is 'Customer reviews for menu items, vendor experience, and delivery experience after eligible completion.';

create index reviews_vendor_idx on public.reviews (vendor_id, created_at desc) where vendor_id is not null;
create index reviews_menu_item_idx on public.reviews (menu_item_id, created_at desc) where menu_item_id is not null;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint outbox_events_event_type_not_blank check (length(btrim(event_type)) > 0),
  constraint outbox_events_aggregate_type_not_blank check (length(btrim(aggregate_type)) > 0),
  constraint outbox_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint outbox_events_attempts_non_negative check (attempts >= 0)
);

comment on table public.outbox_events is 'Transactional outbox for backend workers and notifications.';

create index outbox_events_available_idx on public.outbox_events (available_at, attempts) where processed_at is null and locked_at is null;
create index outbox_events_aggregate_idx on public.outbox_events (aggregate_type, aggregate_id);

create or replace function public.calculate_delivery_earnings(p_order_count integer)
returns integer
language sql
immutable
as $$
  select greatest(p_order_count, 0) * 7500;
$$;

comment on function public.calculate_delivery_earnings(integer) is 'Calculates delivery earnings as NGN 75 in kobo multiplied by eligible completed orders.';

create or replace function public.enforce_order_insert_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_status = 'pending_payment'
     and coalesce(new.created_at, now()) >= public.effective_ordering_cutoff_at(new.service_date, new.delivery_slot_id) then
    raise exception 'orders close % minutes before the scheduled delivery time', (
      select cutoff_minutes from public.delivery_slots where id = new.delivery_slot_id
    ) using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_order_insert_cutoff() is 'Rejects pending order creation at or after the slot cutoff.';

create trigger orders_enforce_insert_cutoff
before insert on public.orders
for each row execute function public.enforce_order_insert_cutoff();

create or replace function public.protect_order_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.order_status <> 'pending_payment' then
      raise exception 'paid or operational orders cannot be deleted' using errcode = '23000';
    end if;
    return old;
  end if;

  if new.order_number <> old.order_number then
    raise exception 'order_number is immutable' using errcode = '23000';
  end if;

  if old.order_status <> 'pending_payment'
     and (
       new.food_subtotal_kobo <> old.food_subtotal_kobo
       or new.delivery_fee_kobo <> old.delivery_fee_kobo
       or new.platform_delivery_share_kobo <> old.platform_delivery_share_kobo
       or new.fulfiller_delivery_share_kobo <> old.fulfiller_delivery_share_kobo
       or new.discount_kobo <> old.discount_kobo
       or new.total_kobo <> old.total_kobo
       or new.currency <> old.currency
     ) then
    raise exception 'financial snapshots cannot change after payment' using errcode = '23000';
  end if;

  return new;
end;
$$;

comment on function public.protect_order_financial_history() is 'Protects order number and paid-order financial snapshots from mutation.';

create trigger orders_protect_financial_history
before update or delete on public.orders
for each row execute function public.protect_order_financial_history();

create or replace function public.prevent_paid_order_item_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  select order_status into v_status from public.orders where id = v_order_id;

  if v_status <> 'pending_payment' then
    raise exception 'order items cannot change after payment without an administrative correction process' using errcode = '23000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.prevent_paid_order_item_changes() is 'Prevents changing order item snapshots after an order leaves pending payment.';

create trigger order_items_prevent_paid_changes
before update or delete on public.order_items
for each row execute function public.prevent_paid_order_item_changes();

create or replace function public.validate_order_item_rollups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_expected_subtotal integer;
  v_actual_subtotal integer;
  v_spoon_units integer;
begin
  select food_subtotal_kobo into v_expected_subtotal
  from public.orders
  where id = v_order_id;

  select coalesce(sum(line_total_kobo), 0),
         coalesce(sum(case when ut.counts_toward_spoon_limit then oi.quantity else 0 end), 0)
  into v_actual_subtotal, v_spoon_units
  from public.order_items oi
  join public.menu_items mi on mi.id = oi.menu_item_id
  join public.unit_types ut on ut.id = mi.unit_type_id
  where oi.order_id = v_order_id;

  if v_actual_subtotal <> v_expected_subtotal then
    raise exception 'order food subtotal must equal sum of line totals' using errcode = '23514';
  end if;

  if v_spoon_units > 3 then
    raise exception 'one takeaway package cannot contain more than three spoon-based units' using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public.validate_order_item_rollups() is 'Deferred validation that order item totals and spoon-limited quantities match order rules.';

create constraint trigger order_items_validate_rollups
after insert or update or delete on public.order_items
deferrable initially deferred
for each row execute function public.validate_order_item_rollups();

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
  p_request_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_resource_id uuid;
  v_location_zone_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_food_subtotal integer := 0;
  v_spoon_units integer := 0;
  v_delivery_mode public.delivery_mode;
  v_item record;
  v_catalog record;
  v_inventory record;
  v_remaining integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item' using errcode = '23514';
  end if;

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

  select cl.zone_id into v_location_zone_id
  from public.campus_locations cl
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
    total_kobo,
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
    v_food_subtotal + 15000,
    least(public.effective_ordering_cutoff_at(p_service_date, p_delivery_slot_id), now() + interval '15 minutes')
  )
  returning id, order_number into v_order_id, v_order_number;

  for v_item in
    select menu_item_id::uuid, quantity::integer
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer)
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
      line_total_kobo
    )
    values (
      v_order_id,
      v_item.menu_item_id,
      v_catalog.name,
      v_catalog.unit_code,
      v_catalog.price_kobo,
      v_item.quantity,
      v_catalog.price_kobo * v_item.quantity
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

comment on function public.create_pending_order_and_reserve_inventory(uuid, uuid, uuid, date, uuid, uuid, public.delivery_mode, jsonb, text, text) is 'Creates a pending-payment order, reserves inventory under row locks, enforces cutoff and spoon limits, and records idempotency.';

create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_released integer := 0;
begin
  for v_order in
    select *
    from public.orders
    where order_status = 'pending_payment'
      and inventory_reservation_expires_at < now()
    for update skip locked
  loop
    update public.menu_item_inventory inv
    set quantity_reserved = inv.quantity_reserved - oi.quantity,
        version = inv.version + 1
    from public.order_items oi
    where oi.order_id = v_order.id
      and inv.menu_item_id = oi.menu_item_id
      and inv.service_date = v_order.service_date
      and inv.delivery_slot_id = v_order.delivery_slot_id;

    update public.orders
    set order_status = 'expired',
        cancelled_at = now(),
        cancellation_reason = 'payment reservation expired'
    where id = v_order.id;

    insert into public.order_status_history (order_id, from_status, to_status, reason)
    values (v_order.id, 'pending_payment', 'expired', 'payment reservation expired');

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

comment on function public.release_expired_reservations() is 'Releases inventory for pending-payment orders whose payment reservation window expired.';

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_actor_user_id uuid default auth.uid(),
  p_reason text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_status public.order_status;
begin
  select order_status into v_from_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if v_from_status = p_to_status then
    return p_to_status;
  end if;

  if not (
    (v_from_status = 'pending_payment' and p_to_status in ('paid', 'expired', 'cancelled')) or
    (v_from_status = 'paid' and p_to_status in ('accepted', 'cancelled', 'refunded')) or
    (v_from_status = 'accepted' and p_to_status in ('preparing', 'cancelled')) or
    (v_from_status = 'preparing' and p_to_status in ('ready', 'cancelled')) or
    (v_from_status = 'ready' and p_to_status in ('out_for_delivery', 'cancelled')) or
    (v_from_status = 'out_for_delivery' and p_to_status in ('delivered', 'cancelled')) or
    (v_from_status = 'delivered' and p_to_status in ('confirmed', 'administratively_completed', 'refunded')) or
    (v_from_status = 'confirmed' and p_to_status = 'refunded') or
    (v_from_status = 'administratively_completed' and p_to_status = 'refunded')
  ) then
    raise exception 'invalid order status transition from % to %', v_from_status, p_to_status using errcode = '23514';
  end if;

  update public.orders
  set order_status = p_to_status,
      accepted_at = case when p_to_status = 'accepted' then now() else accepted_at end,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      confirmed_at = case when p_to_status in ('confirmed', 'administratively_completed') then now() else confirmed_at end,
      cancelled_at = case when p_to_status in ('cancelled', 'expired') then now() else cancelled_at end,
      cancellation_reason = case when p_to_status in ('cancelled', 'expired') then p_reason else cancellation_reason end
  where id = p_order_id;

  insert into public.order_status_history (
    order_id,
    from_status,
    to_status,
    actor_user_id,
    reason,
    request_id,
    metadata
  )
  values (
    p_order_id,
    v_from_status,
    p_to_status,
    p_actor_user_id,
    p_reason,
    p_request_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return p_to_status;
end;
$$;

comment on function public.transition_order_status(uuid, public.order_status, uuid, text, text, jsonb) is 'Transitions an order through the allowed status matrix and appends status history.';

create or replace function public.add_paid_order_to_batch(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_batch_id uuid;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if v_order.order_status not in ('paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'confirmed', 'administratively_completed') then
    raise exception 'only paid or operational orders can be batched' using errcode = '23514';
  end if;

  insert into public.delivery_batches (
    campus_id,
    vendor_id,
    service_date,
    delivery_slot_id,
    zone_id,
    batch_number,
    delivery_mode,
    cutoff_at
  )
  values (
    v_order.campus_id,
    v_order.vendor_id,
    v_order.service_date,
    v_order.delivery_slot_id,
    v_order.zone_id,
    'MDB-' || to_char(v_order.service_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_order.delivery_mode,
    public.effective_ordering_cutoff_at(v_order.service_date, v_order.delivery_slot_id)
  )
  on conflict (campus_id, vendor_id, service_date, delivery_slot_id, zone_id, delivery_mode)
  do update set updated_at = now()
  returning id into v_batch_id;

  insert into public.delivery_batch_orders (batch_id, order_id)
  values (v_batch_id, p_order_id)
  on conflict (order_id) do nothing;

  update public.delivery_batches db
  set order_count = batch_counts.order_count,
      delivery_earnings_kobo = public.calculate_delivery_earnings(batch_counts.order_count)
  from (
    select batch_id, count(*)::integer as order_count
    from public.delivery_batch_orders
    where batch_id = v_batch_id
    group by batch_id
  ) batch_counts
  where db.id = batch_counts.batch_id;

  return v_batch_id;
end;
$$;

comment on function public.add_paid_order_to_batch(uuid) is 'Adds one paid order to its logical delivery batch and recalculates batch delivery earnings.';

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

  update public.payments
  set status = 'successful',
      provider_transaction_id = p_provider_transaction_id,
      paid_amount_kobo = p_paid_amount_kobo,
      verified_at = now(),
      paid_at = now(),
      provider_payload = coalesce(p_provider_payload, '{}'::jsonb)
  where id = v_payment.id;

  update public.menu_item_inventory inv
  set quantity_reserved = inv.quantity_reserved - oi.quantity,
      quantity_sold = inv.quantity_sold + oi.quantity,
      version = inv.version + 1
  from public.order_items oi
  where oi.order_id = v_order.id
    and inv.menu_item_id = oi.menu_item_id
    and inv.service_date = v_order.service_date
    and inv.delivery_slot_id = v_order.delivery_slot_id;

  update public.orders
  set order_status = 'paid',
      paid_at = now()
  where id = v_order.id
    and order_status = 'pending_payment';

  insert into public.order_status_history (order_id, from_status, to_status, reason)
  values (v_order.id, 'pending_payment', 'paid', 'verified provider payment');

  perform public.add_paid_order_to_batch(v_order.id);

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values ('payment.successful', 'order', v_order.id, jsonb_build_object('provider_reference', p_provider_reference));

  return v_order.id;
end;
$$;

comment on function public.mark_verified_payment_successful(public.payment_provider, text, text, integer, jsonb) is 'Marks a Paystack payment successful, converts reservations to sold inventory, transitions the order, and batches it.';

create or replace function public.record_payment_event(
  p_provider public.payment_provider,
  p_event_fingerprint text,
  p_event_type text,
  p_provider_reference text,
  p_signature_valid boolean,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_events (
    provider,
    event_fingerprint,
    event_type,
    provider_reference,
    signature_valid,
    payload
  )
  values (
    p_provider,
    p_event_fingerprint,
    p_event_type,
    p_provider_reference,
    p_signature_valid,
    p_payload
  )
  on conflict (provider, event_fingerprint) do nothing;

  return found;
end;
$$;

comment on function public.record_payment_event(public.payment_provider, text, text, text, boolean, jsonb) is 'Deduplicates provider webhook events by fingerprint and returns whether a new row was inserted.';

create or replace function public.close_batches_at_cutoff()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.delivery_batches
  set status = 'closed',
      closed_at = now()
  where status = 'open'
    and cutoff_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.close_batches_at_cutoff() is 'Closes open delivery batches once their ordering cutoff has passed.';

create or replace function public.produce_vendor_daily_settlement(
  p_vendor_id uuid,
  p_settlement_date date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_settlement_id uuid;
  v_food integer;
  v_delivery integer;
  v_refunds integer;
begin
  select campus_id into v_campus_id from public.vendors where id = p_vendor_id;
  if v_campus_id is null then
    raise exception 'vendor % not found', p_vendor_id using errcode = 'P0002';
  end if;

  select coalesce(sum(food_subtotal_kobo), 0)
  into v_food
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded');

  select coalesce(sum(fulfiller_delivery_share_kobo), 0)
  into v_delivery
  from public.orders
  where vendor_id = p_vendor_id
    and service_date = p_settlement_date
    and delivery_mode = 'vendor_delivery'
    and order_status in ('delivered', 'confirmed', 'administratively_completed');

  select coalesce(sum(r.amount_kobo), 0)
  into v_refunds
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and r.status = 'succeeded';

  insert into public.settlements (
    campus_id,
    vendor_id,
    settlement_date,
    gross_food_amount_kobo,
    delivery_earnings_kobo,
    refunds_kobo,
    payable_kobo,
    created_by
  )
  values (
    v_campus_id,
    p_vendor_id,
    p_settlement_date,
    v_food,
    v_delivery,
    v_refunds,
    v_food + v_delivery - v_refunds,
    p_created_by
  )
  on conflict (vendor_id, settlement_date) where vendor_id is not null
  do update set
    gross_food_amount_kobo = excluded.gross_food_amount_kobo,
    delivery_earnings_kobo = excluded.delivery_earnings_kobo,
    refunds_kobo = excluded.refunds_kobo,
    payable_kobo = excluded.payable_kobo,
    updated_at = now()
  returning id into v_settlement_id;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'food', o.food_subtotal_kobo, 'Food subtotal for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
  on conflict do nothing;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'vendor_delivery', o.fulfiller_delivery_share_kobo, 'Vendor delivery share for ' || o.order_number
  from public.orders o
  where o.vendor_id = p_vendor_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'vendor_delivery'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
  on conflict do nothing;

  return v_settlement_id;
end;
$$;

comment on function public.produce_vendor_daily_settlement(uuid, date, uuid) is 'Calculates vendor daily food payout, vendor-delivery earnings, refunds, and settlement lines.';

create or replace function public.produce_rider_daily_settlement(
  p_rider_id uuid,
  p_settlement_date date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_settlement_id uuid;
  v_delivery integer;
begin
  select campus_id into v_campus_id from public.riders where id = p_rider_id;
  if v_campus_id is null then
    raise exception 'rider % not found', p_rider_id using errcode = 'P0002';
  end if;

  select coalesce(sum(o.fulfiller_delivery_share_kobo), 0)
  into v_delivery
  from public.delivery_assignments da
  join public.delivery_batch_orders dbo on dbo.batch_id = da.batch_id
  join public.orders o on o.id = dbo.order_id
  where da.rider_id = p_rider_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'meal_direct_rider'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed');

  insert into public.settlements (
    campus_id,
    rider_id,
    settlement_date,
    delivery_earnings_kobo,
    payable_kobo,
    created_by
  )
  values (
    v_campus_id,
    p_rider_id,
    p_settlement_date,
    v_delivery,
    v_delivery,
    p_created_by
  )
  on conflict (rider_id, settlement_date) where rider_id is not null
  do update set
    delivery_earnings_kobo = excluded.delivery_earnings_kobo,
    payable_kobo = excluded.payable_kobo,
    updated_at = now()
  returning id into v_settlement_id;

  insert into public.settlement_lines (settlement_id, order_id, line_type, amount_kobo, description)
  select v_settlement_id, o.id, 'rider_delivery', o.fulfiller_delivery_share_kobo, 'Rider delivery share for ' || o.order_number
  from public.delivery_assignments da
  join public.delivery_batch_orders dbo on dbo.batch_id = da.batch_id
  join public.orders o on o.id = dbo.order_id
  where da.rider_id = p_rider_id
    and o.service_date = p_settlement_date
    and o.delivery_mode = 'meal_direct_rider'
    and o.order_status in ('delivered', 'confirmed', 'administratively_completed')
  on conflict do nothing;

  return v_settlement_id;
end;
$$;

comment on function public.produce_rider_daily_settlement(uuid, date, uuid) is 'Calculates daily delivery earnings for a Meal Direct rider from assigned completed batches.';

create or replace function public.confirm_delivery(
  p_order_id uuid,
  p_customer_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmation_id uuid;
begin
  if not exists (
    select 1
    from public.orders
    where id = p_order_id
      and customer_id = p_customer_id
      and order_status in ('delivered', 'administratively_completed')
  ) then
    raise exception 'only delivered orders can be confirmed by their customer' using errcode = '23514';
  end if;

  insert into public.delivery_confirmations (order_id, customer_id, metadata)
  values (p_order_id, p_customer_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (order_id) do update
  set metadata = excluded.metadata
  returning id into v_confirmation_id;

  perform public.transition_order_status(p_order_id, 'confirmed', p_customer_id, 'customer confirmed delivery');

  return v_confirmation_id;
end;
$$;

comment on function public.confirm_delivery(uuid, uuid, jsonb) is 'Records customer delivery confirmation and transitions a delivered order to confirmed.';

create or replace function public.open_escalation(
  p_order_id uuid,
  p_opened_by uuid,
  p_category text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_escalation_id uuid;
begin
  if not exists (
    select 1
    from public.orders
    where id = p_order_id
      and customer_id = p_opened_by
      and order_status not in ('pending_payment', 'expired', 'cancelled')
  ) then
    raise exception 'order is not eligible for escalation by this user' using errcode = '23514';
  end if;

  insert into public.escalations (order_id, opened_by, category, description)
  values (p_order_id, p_opened_by, p_category, p_description)
  returning id into v_escalation_id;

  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values ('order.escalation_opened', 'order', p_order_id, jsonb_build_object('escalation_id', v_escalation_id));

  return v_escalation_id;
end;
$$;

comment on function public.open_escalation(uuid, uuid, text, text) is 'Opens a customer escalation for an eligible paid or operational order.';

create or replace function public.enforce_review_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.orders o
    where o.id = new.order_id
      and o.customer_id = new.reviewer_id
      and o.order_status in ('confirmed', 'administratively_completed')
  ) then
    raise exception 'only confirmed or administratively completed orders can be reviewed by their customer' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_review_eligibility() is 'Ensures reviews are created only by the customer after confirmed or administrative completion.';

create trigger reviews_enforce_eligibility
before insert or update on public.reviews
for each row execute function public.enforce_review_eligibility();

commit;
