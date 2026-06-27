import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type {
  OrderDetail,
  OrderItem,
  OrderListFilters,
  OrderPaymentStatus,
  OrderQuoteItem,
  OrdersRepositoryContract,
  OrderSummary,
  PaymentSnapshot
} from './orders.types.js';

type CreateOrderResult = {
  order_id: string;
};

type ConfirmationResult = {
  confirmation_id: string;
};

export function hashOrderRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

@Injectable()
export class OrdersRepository implements OrdersRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createOrder(
    customerId: string,
    input: CreateOrderDto,
    idempotencyKey: string,
    requestHash: string,
    serviceFeeKobo: number,
    maxOrderTotalKobo: number
  ): Promise<{ orderId: string }> {
    const items = input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      customization: item.customization ?? {}
    }));

    const result = await sql<CreateOrderResult>`
      select public.create_pending_order_and_reserve_inventory(
        ${customerId}::uuid,
        ${input.campusId}::uuid,
        ${input.vendorId}::uuid,
        ${input.serviceDate}::date,
        ${input.deliverySlotId}::uuid,
        ${input.locationId}::uuid,
        ${input.deliveryMode ?? null}::public.delivery_mode,
        ${JSON.stringify(items)}::jsonb,
        ${idempotencyKey},
        ${requestHash},
        ${input.promotionCode ?? null},
        ${input.specialInstructions ?? null},
        ${serviceFeeKobo}::integer,
        ${maxOrderTotalKobo}::integer
      ) as order_id
    `.execute(this.database.db);

    const orderId = result.rows[0]?.order_id;
    if (orderId === undefined) {
      throw new Error('Order creation did not return an order ID.');
    }

    return { orderId };
  }

  async findZoneDeliveryFeeKobo(locationId: string): Promise<number | null> {
    const result = await sql<{ deliveryFeeKobo: number }>`
      select cz.delivery_fee_kobo as "deliveryFeeKobo"
      from public.campus_locations cl
      join public.campus_zones cz on cz.id = cl.zone_id
      where cl.id = ${locationId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.deliveryFeeKobo ?? null;
  }

  async findVendorServiceFeeConfig(
    vendorId: string
  ): Promise<{ serviceFeeKobo: number | null; maxServiceFeeKobo: number } | undefined> {
    const result = await sql<{ serviceFeeKobo: number | null; maxServiceFeeKobo: number }>`
      select v.service_fee_kobo as "serviceFeeKobo",
             c.max_service_fee_kobo as "maxServiceFeeKobo"
      from public.vendors v
      join public.campuses c on c.id = v.campus_id
      where v.id = ${vendorId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async quoteOrder(input: CreateOrderDto): Promise<OrderQuoteItem[]> {
    const items = input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity
    }));

    const result = await sql<OrderQuoteItem>`
      with requested as (
        select menu_item_id, quantity
        from jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          as x(menu_item_id uuid, quantity integer)
      )
      select
        ami.menu_item_id::text as "menuItemId",
        ami.name,
        r.quantity,
        ami.remaining_quantity as "remainingQuantity",
        ami.price_kobo as "unitPriceKobo",
        ami.price_kobo * r.quantity as "lineTotalKobo"
      from requested r
      join public.available_menu_items(
        ${input.campusId}::uuid,
        ${input.serviceDate}::date,
        ${input.deliverySlotId}::uuid
      ) ami on ami.menu_item_id = r.menu_item_id
      where ami.vendor_id = ${input.vendorId}::uuid
        and ami.remaining_quantity >= r.quantity
      order by ami.name
    `.execute(this.database.db);

    return result.rows;
  }

  async listCustomerOrders(customerId: string, filters: OrderListFilters): Promise<OrderSummary[]> {
    const result = await sql<OrderSummary>`
      select
        o.id::text as "id",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        o.campus_id::text as "campusId",
        o.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        o.service_date::text as "serviceDate",
        o.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        o.location_id::text as "locationId",
        cl.name as "locationName",
        o.order_status::text as "orderStatus",
        o.delivery_mode::text as "deliveryMode",
        o.special_instructions as "specialInstructions",
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
        o.service_fee_kobo as "serviceFeeKobo",
        o.discount_kobo as "discountKobo",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt",
        o.paid_at::text as "paidAt",
        o.delivered_at::text as "deliveredAt",
        o.confirmed_at::text as "confirmedAt"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      where o.customer_id = ${customerId}::uuid
        and (${filters.status ?? null}::public.order_status is null or o.order_status = ${filters.status ?? null}::public.order_status)
      order by o.created_at desc
    `.execute(this.database.db);

    return result.rows;
  }

  async findCustomerOrderById(
    customerId: string,
    orderId: string
  ): Promise<OrderDetail | undefined> {
    const order = (await this.listCustomerOrderBase(customerId, orderId)).rows[0];
    if (order === undefined) return undefined;

    const [items, latestPayment] = await Promise.all([
      this.listOrderItems(orderId),
      this.findLatestPayment(orderId)
    ]);

    return {
      ...order,
      items,
      latestPayment
    };
  }

  async findPaymentStatus(
    customerId: string,
    orderId: string
  ): Promise<OrderPaymentStatus | undefined> {
    const order = (await this.listCustomerOrderBase(customerId, orderId)).rows[0];
    if (order === undefined) return undefined;
    return {
      orderId: order.id,
      orderStatus: order.orderStatus,
      payment: await this.findLatestPayment(orderId)
    };
  }

  async confirmDelivery(customerId: string, orderId: string): Promise<{ confirmationId: string }> {
    const result = await sql<ConfirmationResult>`
      select public.confirm_delivery(
        ${orderId}::uuid,
        ${customerId}::uuid,
        '{}'::jsonb
      ) as confirmation_id
    `.execute(this.database.db);

    const confirmationId = result.rows[0]?.confirmation_id;
    if (confirmationId === undefined) {
      throw new Error('Delivery confirmation did not return an ID.');
    }
    return { confirmationId };
  }

  private listCustomerOrderBase(customerId: string, orderId: string) {
    return sql<OrderSummary>`
      select
        o.id::text as "id",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        o.campus_id::text as "campusId",
        o.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        o.service_date::text as "serviceDate",
        o.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        o.location_id::text as "locationId",
        cl.name as "locationName",
        o.order_status::text as "orderStatus",
        o.delivery_mode::text as "deliveryMode",
        o.special_instructions as "specialInstructions",
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
        o.service_fee_kobo as "serviceFeeKobo",
        o.discount_kobo as "discountKobo",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt",
        o.paid_at::text as "paidAt",
        o.delivered_at::text as "deliveredAt",
        o.confirmed_at::text as "confirmedAt"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      where o.customer_id = ${customerId}::uuid
        and o.id = ${orderId}::uuid
    `.execute(this.database.db);
  }

  private async listOrderItems(orderId: string): Promise<OrderItem[]> {
    const result = await sql<OrderItem>`
      select
        id::text as "id",
        menu_item_id::text as "menuItemId",
        item_name as "itemName",
        unit_type as "unitType",
        unit_price_kobo as "unitPriceKobo",
        quantity,
        line_total_kobo as "lineTotalKobo",
        customization
      from public.order_items
      where order_id = ${orderId}::uuid
      order by created_at
    `.execute(this.database.db);

    return result.rows;
  }

  private async findLatestPayment(orderId: string): Promise<PaymentSnapshot | null> {
    const result = await sql<PaymentSnapshot>`
      select
        id::text as "id",
        provider::text as "provider",
        provider_reference as "providerReference",
        status::text as "status",
        expected_amount_kobo as "expectedAmountKobo",
        paid_amount_kobo as "paidAmountKobo",
        currency,
        initialized_at::text as "initializedAt",
        verified_at::text as "verifiedAt",
        paid_at::text as "paidAt"
      from public.payments
      where order_id = ${orderId}::uuid
      order by created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0] ?? null;
  }
}
