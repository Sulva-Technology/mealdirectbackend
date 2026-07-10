import { createHash, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { DatabaseSchema } from '../../database/database.types.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type {
  CreatedOrder,
  DeliveryHandoff,
  LargeOrderSurchargeConfig,
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

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export function hashOrderRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const deliveryHandoffInstruction =
  'Give this code to the rider only after you receive your order. The rider will ask for it to confirm delivery.';

function buildDeliveryHandoff(deliveryCode: string | null | undefined): DeliveryHandoff | null {
  if (deliveryCode == null) return null;
  return {
    code: deliveryCode,
    instruction: deliveryHandoffInstruction
  };
}

function normalizeRoomNumber(roomNumber: string | undefined): string | null {
  const trimmed = roomNumber?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
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
    maxOrderTotalKobo: number,
    largeOrderSurcharge: LargeOrderSurchargeConfig
  ): Promise<CreatedOrder> {
    const items = input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      customization: item.customization ?? {},
      soup_option_id: item.soupOptionId ?? null
    }));

    return this.database.db.transaction().execute(async (trx) => {
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
          ${maxOrderTotalKobo}::integer,
          ${largeOrderSurcharge.surchargeBps}::integer,
          ${largeOrderSurcharge.surchargeFlatKobo}::integer,
          ${largeOrderSurcharge.accepted}::boolean
        ) as order_id
      `.execute(trx);

      const orderId = result.rows[0]?.order_id;
      if (orderId === undefined) {
        throw new Error('Order creation did not return an order ID.');
      }

      const deliveryCode = await this.ensureOrderDeliveryMetadata(
        orderId,
        normalizeRoomNumber(input.roomNumber),
        trx
      );

      return { orderId, deliveryHandoff: buildDeliveryHandoff(deliveryCode) };
    });
  }

  private async ensureOrderDeliveryMetadata(
    orderId: string,
    roomNumber: string | null,
    executor: DatabaseExecutor
  ): Promise<string> {
    const existing = await sql<{ deliveryCode: string | null }>`
      select delivery_code as "deliveryCode"
      from public.orders
      where id = ${orderId}::uuid
      for update
    `.execute(executor);

    const existingCode = existing.rows[0]?.deliveryCode;
    if (existingCode !== undefined && existingCode !== null) {
      await sql`
        update public.orders
        set room_number = ${roomNumber}
        where id = ${orderId}::uuid
      `.execute(executor);
      return existingCode;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = String(randomInt(0, 10000)).padStart(4, '0');
      const result = await sql<{ deliveryCode: string }>`
        update public.orders
        set room_number = ${roomNumber},
            delivery_code = ${code}
        where id = ${orderId}::uuid
          and not exists (
            select 1
            from public.orders o2
            where o2.id <> public.orders.id
              and o2.delivery_code = ${code}
              and o2.order_status in (
                'accepted',
                'pending_payment',
                'paid',
                'preparing',
                'ready',
                'out_for_delivery'
              )
          )
        returning delivery_code as "deliveryCode"
      `.execute(executor);

      const assigned = result.rows[0]?.deliveryCode;
      if (assigned !== undefined) {
        return assigned;
      }
    }

    throw new Error('Could not assign a unique delivery code after several attempts.');
  }

  async findLocationType(locationId: string): Promise<'department' | 'hostel' | undefined> {
    const result = await sql<{ type: 'department' | 'hostel' }>`
      select type::text as "type"
      from public.campus_locations
      where id = ${locationId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.type;
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
        ami.price_kobo * r.quantity as "lineTotalKobo",
        ut.counts_toward_spoon_limit as "countsTowardSpoonLimit",
        ut.triggers_takeaway_fee as "triggersTakeawayFee"
      from requested r
      join public.available_menu_items(
        ${input.campusId}::uuid,
        ${input.serviceDate}::date,
        ${input.deliverySlotId}::uuid
      ) ami on ami.menu_item_id = r.menu_item_id
      join public.unit_types ut on ut.id = ami.unit_type_id
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
        o.room_number as "roomNumber",
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
        o.service_fee_kobo as "serviceFeeKobo",
        o.discount_kobo as "discountKobo",
        o.large_order_surcharge_kobo as "largeOrderSurchargeKobo",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt",
        o.paid_at::text as "paidAt",
        o.delivered_at::text as "deliveredAt",
        o.confirmed_at::text as "confirmedAt",
        o.delivery_code as "deliveryCode",
        case
          when o.delivery_code is null then null
          else jsonb_build_object(
            'code', o.delivery_code,
            'instruction', ${deliveryHandoffInstruction}
          )
        end as "deliveryHandoff"
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
        o.room_number as "roomNumber",
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.delivery_fee_kobo as "deliveryFeeKobo",
        o.service_fee_kobo as "serviceFeeKobo",
        o.discount_kobo as "discountKobo",
        o.large_order_surcharge_kobo as "largeOrderSurchargeKobo",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt",
        o.paid_at::text as "paidAt",
        o.delivered_at::text as "deliveredAt",
        o.confirmed_at::text as "confirmedAt",
        o.delivery_code as "deliveryCode",
        dbo.batch_id::text as "batchId",
        case
          when o.delivery_code is null then null
          else jsonb_build_object(
            'code', o.delivery_code,
            'instruction', ${deliveryHandoffInstruction}
          )
        end as "deliveryHandoff"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      left join public.delivery_batch_orders dbo on dbo.order_id = o.id
      where o.customer_id = ${customerId}::uuid
        and o.id = ${orderId}::uuid
    `.execute(this.database.db);
  }

  private async listOrderItems(orderId: string): Promise<OrderItem[]> {
    const result = await sql<OrderItem>`
      select
        oi.id::text as "id",
        oi.menu_item_id::text as "menuItemId",
        oi.item_name as "itemName",
        oi.unit_type as "unitType",
        oi.unit_price_kobo as "unitPriceKobo",
        oi.quantity,
        oi.line_total_kobo as "lineTotalKobo",
        oi.customization,
        oi.soup_option_id::text as "soupOptionId",
        so.name as "soupName"
      from public.order_items oi
      left join public.vendor_soup_options so on so.id = oi.soup_option_id
      where oi.order_id = ${orderId}::uuid
      order by oi.created_at
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
