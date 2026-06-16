import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  OrderDetail,
  OrderItem,
  OrderStatus,
  OrderSummary,
  PaymentSnapshot
} from '../orders/orders.types.js';

@Injectable()
export class VendorOrdersRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async listVendorOrders(
    vendorId: string,
    filters: { status?: OrderStatus; date?: string },
    pagination: { page: number; limit: number }
  ): Promise<OrderSummary[]> {
    const offset = (pagination.page - 1) * pagination.limit;

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
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
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
      where o.vendor_id = ${vendorId}::uuid
        and (${filters.status ?? null}::public.order_status is null or o.order_status = ${filters.status ?? null}::public.order_status)
        and (${filters.date ?? null}::date is null or o.service_date = ${filters.date ?? null}::date)
      order by o.created_at desc
      limit ${pagination.limit} offset ${offset}
    `.execute(this.database.db);

    return result.rows;
  }

  async findVendorOrderById(vendorId: string, orderId: string): Promise<OrderDetail | undefined> {
    const orderResult = await sql<OrderSummary>`
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
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
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
      where o.vendor_id = ${vendorId}::uuid
        and o.id = ${orderId}::uuid
    `.execute(this.database.db);

    const order = orderResult.rows[0];
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

  async transitionOrderStatus(
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string
  ): Promise<OrderStatus> {
    const result = await sql<{ order_status: OrderStatus }>`
      select public.transition_order_status(
        ${orderId}::uuid,
        ${toStatus}::public.order_status,
        ${actorUserId}::uuid
      ) as order_status
    `.execute(this.database.db);

    const status = result.rows[0]?.order_status;
    if (status === undefined) {
      throw new Error(`Order status transition failed to return a status.`);
    }

    return status;
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
        line_total_kobo as "lineTotalKobo"
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
