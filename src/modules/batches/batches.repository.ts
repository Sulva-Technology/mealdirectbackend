import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { OrderSummary } from '../orders/orders.types.js';
import type { BatchListFilters, BatchSummary, BatchesRepositoryContract } from './batches.types.js';

@Injectable()
export class BatchesRepository implements BatchesRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async listVendorBatches(vendorId: string, filters: BatchListFilters): Promise<BatchSummary[]> {
    const result = await sql<BatchSummary>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        vendor_id::text as "vendorId",
        service_date::text as "serviceDate",
        delivery_slot_id::text as "deliverySlotId",
        zone_id::text as "zoneId",
        batch_number as "batchNumber",
        status::text as "status",
        delivery_mode::text as "deliveryMode",
        order_count as "orderCount",
        delivery_earnings_kobo as "deliveryEarningsKobo",
        cutoff_at::text as "cutoffAt",
        closed_at::text as "closedAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.delivery_batches
      where vendor_id = ${vendorId}::uuid
        and (${filters.status ?? null}::public.batch_status is null or status = ${filters.status ?? null}::public.batch_status)
        and (${filters.date ?? null}::date is null or service_date = ${filters.date ?? null}::date)
      order by created_at desc
    `.execute(this.database.db);

    return result.rows;
  }

  async findVendorBatchById(vendorId: string, batchId: string): Promise<BatchSummary | undefined> {
    const result = await sql<BatchSummary>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        vendor_id::text as "vendorId",
        service_date::text as "serviceDate",
        delivery_slot_id::text as "deliverySlotId",
        zone_id::text as "zoneId",
        batch_number as "batchNumber",
        status::text as "status",
        delivery_mode::text as "deliveryMode",
        order_count as "orderCount",
        delivery_earnings_kobo as "deliveryEarningsKobo",
        cutoff_at::text as "cutoffAt",
        closed_at::text as "closedAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.delivery_batches
      where vendor_id = ${vendorId}::uuid
        and id = ${batchId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findBatchOrders(batchId: string): Promise<OrderSummary[]> {
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
        o.confirmed_at::text as "confirmedAt"
      from public.orders o
      join public.delivery_batch_orders dbo on dbo.order_id = o.id
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      where dbo.batch_id = ${batchId}::uuid
      order by dbo.sequence nulls last, dbo.added_at
    `.execute(this.database.db);

    return result.rows;
  }

  async pickupBatch(batchId: string, actorUserId: string): Promise<void> {
    await this.database.db.transaction().execute(async (trx) => {
      // 1. Transition batch status to 'in_progress'
      await sql`
        update public.delivery_batches
        set status = 'in_progress',
            updated_at = now()
        where id = ${batchId}::uuid
      `.execute(trx);

      // 2. Transition active assignment to 'picked_up'
      await sql`
        update public.delivery_assignments
        set status = 'picked_up',
            picked_up_at = now()
        where batch_id = ${batchId}::uuid
          and status in ('assigned', 'accepted')
      `.execute(trx);

      // 3. Find all orders associated with this batch
      const ordersResult = await sql<{ order_id: string }>`
        select order_id::text as "order_id"
        from public.delivery_batch_orders
        where batch_id = ${batchId}::uuid
      `.execute(trx);

      // 4. Transition all constituent orders to 'out_for_delivery'
      for (const row of ordersResult.rows) {
        await sql`
          select public.transition_order_status(
            ${row.order_id}::uuid,
            'out_for_delivery'::public.order_status,
            ${actorUserId}::uuid
          )
        `.execute(trx);
      }
    });
  }
}
