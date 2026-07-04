import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { decodeCursor } from '../../common/api/pagination.js';
import type {
  OrderDetail,
  OrderItem,
  OrderStatus,
  PaymentSnapshot
} from '../orders/orders.types.js';
import type {
  RiderAssignmentListFilters,
  RiderAssignmentSummary,
  RiderEarningsBatch,
  RiderEarningsSummary,
  RiderIssueInput,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderOnboardRepositoryInput,
  RiderPayoutAccount,
  RiderPayoutAccountRecordInput,
  RiderPayoutTransfer,
  RiderProfile,
  RiderProfileUpdateInput,
  RiderSettlementDetail,
  RiderSettlementLine,
  RiderSettlementListFilters,
  RiderSettlementSummary,
  RidersRepositoryContract
} from './riders.types.js';

function decodeRiderTransferCursor(
  cursor: string
): { createdAt: string; id: string } | undefined {
  try {
    const payload = decodeCursor(cursor);
    if (typeof payload.createdAt === 'string' && typeof payload.id === 'string') {
      return { createdAt: payload.createdAt, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const deliveryEarningRateKobo = 7500;

@Injectable()
export class RidersRepository implements RidersRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findRiderProfileForActor(
    userId: string,
    riderId?: string
  ): Promise<RiderProfile | undefined> {
    const result = await sql<RiderProfile>`
      select
        r.id::text as "id",
        r.campus_id::text as "campusId",
        c.name as "campusName",
        r.user_id::text as "userId",
        r.display_name as "displayName",
        r.phone,
        r.status::text as "status",
        r.active,
        r.available,
        r.verified_at::text as "verifiedAt",
        r.created_at::text as "createdAt",
        r.updated_at::text as "updatedAt"
      from public.riders r
      join public.campuses c on c.id = r.campus_id
      where r.user_id = ${userId}::uuid
        and (${riderId ?? null}::uuid is null or r.id = ${riderId ?? null}::uuid)
      order by r.active desc, r.created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findRiderIdForUser(userId: string): Promise<string | undefined> {
    const result = await sql<{ riderId: string }>`
      select id::text as "riderId"
      from public.riders
      where user_id = ${userId}::uuid
      order by active desc, created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0]?.riderId;
  }

  async onboardRider(input: RiderOnboardRepositoryInput): Promise<RiderProfile> {
    const inserted = await sql<{ id: string }>`
      insert into public.riders (
        campus_id,
        user_id,
        display_name,
        phone,
        status,
        active
      )
      values (
        ${input.campusId}::uuid,
        ${input.userId}::uuid,
        ${input.displayName},
        ${input.phone},
        'pending'::public.rider_status,
        false
      )
      returning id::text as "id"
    `.execute(this.database.db);

    const riderId = inserted.rows[0]?.id;
    if (riderId === undefined) {
      throw new Error('Rider insert did not return a row.');
    }

    const profile = await this.findRiderProfileForActor(input.userId, riderId);
    if (profile === undefined) {
      throw new Error('Rider onboarding did not return a profile.');
    }
    return profile;
  }

  async updateRiderProfile(
    riderId: string,
    userId: string,
    input: RiderProfileUpdateInput
  ): Promise<RiderProfile | undefined> {
    const hasDisplayName = Object.hasOwn(input, 'displayName');
    const hasPhone = Object.hasOwn(input, 'phone');

    const result = await sql<RiderProfile>`
      update public.riders
      set
        display_name = case when ${hasDisplayName} then ${input.displayName ?? null} else display_name end,
        phone = case when ${hasPhone} then ${input.phone ?? null} else phone end,
        updated_at = now()
      where id = ${riderId}::uuid
        and user_id = ${userId}::uuid
      returning
        id::text as "id",
        campus_id::text as "campusId",
        (select c.name from public.campuses c where c.id = riders.campus_id) as "campusName",
        user_id::text as "userId",
        display_name as "displayName",
        phone,
        status::text as "status",
        active,
        available,
        verified_at::text as "verifiedAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async setRiderAvailability(
    riderId: string,
    userId: string,
    available: boolean
  ): Promise<RiderProfile | undefined> {
    const result = await sql<RiderProfile>`
      update public.riders
      set available = ${available},
          updated_at = now()
      where id = ${riderId}::uuid
        and user_id = ${userId}::uuid
      returning
        id::text as "id",
        campus_id::text as "campusId",
        (select c.name from public.campuses c where c.id = riders.campus_id) as "campusName",
        user_id::text as "userId",
        display_name as "displayName",
        phone,
        status::text as "status",
        active,
        available,
        verified_at::text as "verifiedAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findActivePayoutAccount(riderId: string): Promise<RiderPayoutAccount | undefined> {
    const result = await sql<RiderPayoutAccount>`
      select
        id::text as "id",
        rider_id::text as "riderId",
        paystack_recipient_code as "paystackRecipientCode",
        bank_name as "bankName",
        bank_code as "bankCode",
        masked_account_number as "maskedAccountNumber",
        account_name as "accountName",
        verified_at::text as "verifiedAt",
        admin_review_status as "adminReviewStatus",
        failure_reason as "failureReason",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.rider_payout_accounts
      where rider_id = ${riderId}::uuid
        and active
      order by updated_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async upsertPayoutAccount(
    riderId: string,
    input: RiderPayoutAccountRecordInput
  ): Promise<RiderPayoutAccount> {
    return this.database.db.transaction().execute(async (trx) => {
      await sql`
        update public.rider_payout_accounts
        set active = false,
            updated_at = now()
        where rider_id = ${riderId}::uuid
          and active
      `.execute(trx);

      const result = await sql<RiderPayoutAccount>`
        insert into public.rider_payout_accounts (
          rider_id,
          paystack_recipient_code,
          bank_name,
          bank_code,
          masked_account_number,
          account_name,
          verified_at,
          admin_review_status,
          active
        )
        values (
          ${riderId}::uuid,
          ${input.paystackRecipientCode},
          ${input.bankName},
          ${input.bankCode ?? null},
          ${input.maskedAccountNumber},
          ${input.accountName},
          now(),
          'pending',
          true
        )
        returning
          id::text as "id",
          rider_id::text as "riderId",
          paystack_recipient_code as "paystackRecipientCode",
          bank_name as "bankName",
          bank_code as "bankCode",
          masked_account_number as "maskedAccountNumber",
          account_name as "accountName",
          verified_at::text as "verifiedAt",
          admin_review_status as "adminReviewStatus",
          failure_reason as "failureReason",
          active,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
      `.execute(trx);

      const account = result.rows[0];
      if (account === undefined) {
        throw new Error('Rider payout account insert did not return a row.');
      }
      return account;
    });
  }

  async markPayoutAccountVerified(riderId: string): Promise<RiderPayoutAccount | undefined> {
    const result = await sql<RiderPayoutAccount>`
      update public.rider_payout_accounts
      set verified_at = now(),
          failure_reason = null,
          updated_at = now()
      where rider_id = ${riderId}::uuid
        and active
      returning
        id::text as "id",
        rider_id::text as "riderId",
        paystack_recipient_code as "paystackRecipientCode",
        bank_name as "bankName",
        bank_code as "bankCode",
        masked_account_number as "maskedAccountNumber",
        account_name as "accountName",
        verified_at::text as "verifiedAt",
        admin_review_status as "adminReviewStatus",
        failure_reason as "failureReason",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listPayoutTransfers(
    riderId: string,
    pagination: { cursor?: string; limit: number }
  ): Promise<RiderPayoutTransfer[]> {
    const cursor =
      pagination.cursor === undefined ? undefined : decodeRiderTransferCursor(pagination.cursor);
    const result = await sql<RiderPayoutTransfer>`
      select
        pt.id::text as "id",
        pt.settlement_id::text as "settlementId",
        s.settlement_date::text as "settlementDate",
        pt.reference,
        pt.amount_kobo as "amountKobo",
        pt.status,
        pt.created_at::text as "createdAt",
        pt.updated_at::text as "updatedAt"
      from public.payout_transfers pt
      join public.settlements s on s.id = pt.settlement_id
      where s.rider_id = ${riderId}::uuid
        and (
          ${cursor?.createdAt ?? null}::timestamptz is null
          or (pt.created_at, pt.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by pt.created_at desc, pt.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);
    return result.rows;
  }

  async assertRiderAccess(riderId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_rider_access(${riderId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async listAssignments(
    riderId: string,
    filters: RiderAssignmentListFilters
  ): Promise<RiderAssignmentSummary[]> {
    const cursorAssignedAt = filters.cursor?.split('|')[0] ?? null;
    const cursorId = filters.cursor?.split('|')[1] ?? null;

    const result = await sql<RiderAssignmentSummary>`
      select
        da.id::text as "id",
        da.batch_id::text as "batchId",
        da.rider_id::text as "riderId",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        v.phone as "vendorPhone",
        db.service_date::text as "serviceDate",
        db.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        ds.delivery_time::text as "deliveryTime",
        db.zone_id::text as "zoneId",
        cz.name as "zoneName",
        da.status::text as "status",
        db.status::text as "batchStatus",
        db.order_count as "orderCount",
        db.delivery_earnings_kobo as "deliveryEarningsKobo",
        da.assigned_at::text as "assignedAt",
        da.accepted_at::text as "acceptedAt",
        da.picked_up_at::text as "pickedUpAt",
        da.completed_at::text as "completedAt"
      from public.delivery_assignments da
      join public.delivery_batches db on db.id = da.batch_id
      join public.vendors v on v.id = db.vendor_id
      join public.delivery_slots ds on ds.id = db.delivery_slot_id
      join public.campus_zones cz on cz.id = db.zone_id
      where da.rider_id = ${riderId}::uuid
        and (${filters.status ?? null}::public.delivery_assignment_status is null or da.status = ${filters.status ?? null}::public.delivery_assignment_status)
        and (${filters.date ?? null}::date is null or db.service_date = ${filters.date ?? null}::date)
        and (
          ${cursorAssignedAt}::timestamptz is null
          or (da.assigned_at, da.id) < (${cursorAssignedAt}::timestamptz, ${cursorId}::uuid)
        )
      order by da.assigned_at desc, da.id desc
      limit ${filters.limit + 1}
    `.execute(this.database.db);

    return result.rows;
  }

  async findAssignmentById(
    riderId: string,
    assignmentId: string
  ): Promise<RiderAssignmentSummary | undefined> {
    const result = await sql<RiderAssignmentSummary>`
      select
        da.id::text as "id",
        da.batch_id::text as "batchId",
        da.rider_id::text as "riderId",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        v.phone as "vendorPhone",
        db.service_date::text as "serviceDate",
        db.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        ds.delivery_time::text as "deliveryTime",
        db.zone_id::text as "zoneId",
        cz.name as "zoneName",
        da.status::text as "status",
        db.status::text as "batchStatus",
        db.order_count as "orderCount",
        db.delivery_earnings_kobo as "deliveryEarningsKobo",
        da.assigned_at::text as "assignedAt",
        da.accepted_at::text as "acceptedAt",
        da.picked_up_at::text as "pickedUpAt",
        da.completed_at::text as "completedAt"
      from public.delivery_assignments da
      join public.delivery_batches db on db.id = da.batch_id
      join public.vendors v on v.id = db.vendor_id
      join public.delivery_slots ds on ds.id = db.delivery_slot_id
      join public.campus_zones cz on cz.id = db.zone_id
      where da.rider_id = ${riderId}::uuid
        and da.id = ${assignmentId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findAssignmentOrders(batchId: string): Promise<OrderDetail[]> {
    const summaries = await this.listBatchOrderSummaries(batchId);
    return Promise.all(
      summaries.map(async (summary) => ({
        ...summary,
        items: await this.listOrderItems(summary.id),
        latestPayment: await this.findLatestPayment(summary.id)
      }))
    );
  }

  async acceptAssignment(
    riderId: string,
    assignmentId: string
  ): Promise<RiderAssignmentSummary | undefined> {
    const result = await sql<{ id: string }>`
      update public.delivery_assignments
      set status = 'accepted',
          accepted_at = coalesce(accepted_at, now())
      where rider_id = ${riderId}::uuid
        and id = ${assignmentId}::uuid
        and status = 'assigned'
      returning id::text as "id"
    `.execute(this.database.db);

    if (result.rows[0] === undefined) {
      return this.findAssignmentById(riderId, assignmentId);
    }

    return this.findAssignmentById(riderId, assignmentId);
  }

  async markAssignmentPickedUp(
    riderId: string,
    assignmentId: string
  ): Promise<RiderAssignmentSummary | undefined> {
    const assignment = await this.findAssignmentById(riderId, assignmentId);
    if (assignment === undefined) return undefined;

    await this.database.db.transaction().execute(async (trx) => {
      await sql`
        update public.delivery_assignments
        set status = 'picked_up',
            picked_up_at = coalesce(picked_up_at, now())
        where rider_id = ${riderId}::uuid
          and id = ${assignmentId}::uuid
          and status in ('assigned', 'accepted', 'picked_up')
      `.execute(trx);

      await sql`
        update public.delivery_batches
        set status = 'in_progress',
            updated_at = now()
        where id = ${assignment.batchId}::uuid
          and status in ('assigned', 'closed', 'in_progress')
      `.execute(trx);
    });

    return this.findAssignmentById(riderId, assignmentId);
  }

  async findAssignedOrderById(
    riderId: string,
    orderId: string
  ): Promise<RiderOrderDetail | undefined> {
    const result = await sql<Omit<RiderOrderDetail, 'items' | 'latestPayment'>>`
      select
        o.id::text as "id",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        coalesce(p.display_name, 'Customer') as "customerDisplayName",
        p.phone_number as "customerPhone",
        o.campus_id::text as "campusId",
        o.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        o.service_date::text as "serviceDate",
        o.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        o.location_id::text as "locationId",
        cl.name as "locationName",
        cl.delivery_instructions as "deliveryInstructions",
        cz.name as "zoneName",
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
        o.confirmed_at::text as "confirmedAt",
        da.id::text as "assignmentId",
        da.batch_id::text as "batchId",
        da.status::text as "assignmentStatus"
      from public.orders o
      join public.delivery_batch_orders dbo on dbo.order_id = o.id
      join public.delivery_assignments da on da.batch_id = dbo.batch_id
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      join public.campus_zones cz on cz.id = o.zone_id
      left join public.profiles p on p.id = o.customer_id
      where da.rider_id = ${riderId}::uuid
        and o.id = ${orderId}::uuid
      limit 1
    `.execute(this.database.db);

    const order = result.rows[0];
    if (order === undefined) return undefined;

    return {
      ...order,
      items: await this.listOrderItems(orderId),
      latestPayment: await this.findLatestPayment(orderId)
    };
  }

  async transitionAssignedOrderStatus(
    riderId: string,
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string
  ): Promise<OrderStatus> {
    const order = await this.findAssignedOrderById(riderId, orderId);
    if (order === undefined) {
      throw new Error('Order was not found for this rider.');
    }

    const result = await sql<{ order_status: OrderStatus }>`
      select public.transition_order_status(
        ${orderId}::uuid,
        ${toStatus}::public.order_status,
        ${actorUserId}::uuid
      ) as order_status
    `.execute(this.database.db);

    const status = result.rows[0]?.order_status;
    if (status === undefined) {
      throw new Error('Order status transition failed.');
    }

    if (toStatus === 'delivered') {
      await this.completeAssignmentIfAllOrdersDelivered(riderId, order.batchId);
    }

    return status;
  }

  async createOrderIssue(
    riderId: string,
    orderId: string,
    actorUserId: string,
    input: RiderIssueInput
  ): Promise<RiderIssueRecord | undefined> {
    const order = await this.findAssignedOrderById(riderId, orderId);
    if (order === undefined) return undefined;

    const result = await sql<RiderIssueRecord>`
      insert into public.escalations (
        order_id,
        opened_by,
        category,
        description
      )
      values (
        ${orderId}::uuid,
        ${actorUserId}::uuid,
        ${`rider_${input.category}`},
        ${input.description}
      )
      returning
        id::text as "id",
        order_id::text as "orderId",
        category,
        description,
        status::text as "status",
        opened_at::text as "openedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async getEarningsSummary(
    riderId: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<RiderEarningsSummary> {
    const result = await sql<RiderEarningsBatch>`
      select
        da.id::text as "assignmentId",
        db.id::text as "batchId",
        db.service_date::text as "serviceDate",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        count(*) filter (where o.order_status in ('delivered', 'confirmed', 'administratively_completed'))::integer as "deliveredOrderCount",
        count(*) filter (where o.order_status in ('confirmed', 'administratively_completed'))::integer as "confirmedOrderCount",
        coalesce(sum(o.fulfiller_delivery_share_kobo) filter (
          where o.order_status = 'delivered'
        ), 0)::integer as "pendingAmountKobo",
        coalesce(sum(o.fulfiller_delivery_share_kobo) filter (
          where o.order_status in ('confirmed', 'administratively_completed')
        ), 0)::integer as "settledAmountKobo",
        coalesce(sum(o.fulfiller_delivery_share_kobo) filter (
          where o.order_status in ('delivered', 'confirmed', 'administratively_completed')
        ), 0)::integer as "totalAmountKobo",
        s.id::text as "settlementId",
        s.status::text as "settlementStatus"
      from public.delivery_assignments da
      join public.delivery_batches db on db.id = da.batch_id
      join public.vendors v on v.id = db.vendor_id
      join public.delivery_batch_orders dbo on dbo.batch_id = db.id
      join public.orders o on o.id = dbo.order_id
      left join public.settlements s on s.rider_id = da.rider_id and s.settlement_date = db.service_date
      where da.rider_id = ${riderId}::uuid
        and o.delivery_mode = 'meal_direct_rider'
        and (${dateFrom ?? null}::date is null or db.service_date >= ${dateFrom ?? null}::date)
        and (${dateTo ?? null}::date is null or db.service_date <= ${dateTo ?? null}::date)
      group by da.id, db.id, v.display_name, s.id, s.status
      order by db.service_date desc, da.assigned_at desc
    `.execute(this.database.db);

    const batches = result.rows;
    return {
      riderId,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      deliveredOrderCount: batches.reduce((sum, batch) => sum + batch.deliveredOrderCount, 0),
      confirmedOrderCount: batches.reduce((sum, batch) => sum + batch.confirmedOrderCount, 0),
      pendingAmountKobo: batches.reduce((sum, batch) => sum + batch.pendingAmountKobo, 0),
      settledAmountKobo: batches.reduce((sum, batch) => sum + batch.settledAmountKobo, 0),
      totalAmountKobo: batches.reduce((sum, batch) => sum + batch.totalAmountKobo, 0),
      currency: 'NGN',
      ratePerOrderKobo: deliveryEarningRateKobo,
      batches
    };
  }

  async listRiderSettlements(
    riderId: string,
    filters: RiderSettlementListFilters
  ): Promise<RiderSettlementSummary[]> {
    const cursorDate = filters.cursor?.split('|')[0] ?? null;
    const cursorId = filters.cursor?.split('|')[1] ?? null;

    const result = await sql<RiderSettlementSummary>`
      select
        s.id::text as "id",
        s.campus_id::text as "campusId",
        s.rider_id::text as "riderId",
        s.settlement_date::text as "settlementDate",
        s.status::text as "status",
        s.delivery_earnings_kobo as "deliveryEarningsKobo",
        s.adjustments_kobo as "adjustmentsKobo",
        s.payable_kobo as "payableKobo",
        s.paid_at::text as "paidAt",
        s.external_reference as "externalReference",
        count(sl.id)::integer as "lineCount",
        s.created_at::text as "createdAt",
        s.updated_at::text as "updatedAt"
      from public.settlements s
      left join public.settlement_lines sl on sl.settlement_id = s.id
      where s.rider_id = ${riderId}::uuid
        and (${filters.status ?? null}::public.settlement_status is null or s.status = ${filters.status ?? null}::public.settlement_status)
        and (
          ${cursorDate}::date is null
          or (s.settlement_date, s.id) < (${cursorDate}::date, ${cursorId}::uuid)
        )
      group by s.id
      order by s.settlement_date desc, s.id desc
      limit ${filters.limit + 1}
    `.execute(this.database.db);

    return result.rows;
  }

  async findRiderSettlementById(
    riderId: string,
    settlementId: string
  ): Promise<RiderSettlementDetail | undefined> {
    const result = await sql<RiderSettlementSummary>`
      select
        s.id::text as "id",
        s.campus_id::text as "campusId",
        s.rider_id::text as "riderId",
        s.settlement_date::text as "settlementDate",
        s.status::text as "status",
        s.delivery_earnings_kobo as "deliveryEarningsKobo",
        s.adjustments_kobo as "adjustmentsKobo",
        s.payable_kobo as "payableKobo",
        s.paid_at::text as "paidAt",
        s.external_reference as "externalReference",
        count(sl.id)::integer as "lineCount",
        s.created_at::text as "createdAt",
        s.updated_at::text as "updatedAt"
      from public.settlements s
      left join public.settlement_lines sl on sl.settlement_id = s.id
      where s.rider_id = ${riderId}::uuid
        and s.id = ${settlementId}::uuid
      group by s.id
      limit 1
    `.execute(this.database.db);

    const settlement = result.rows[0];
    if (settlement === undefined) return undefined;

    return {
      ...settlement,
      lines: await this.listSettlementLines(settlementId)
    };
  }

  private async completeAssignmentIfAllOrdersDelivered(
    riderId: string,
    batchId: string
  ): Promise<void> {
    await sql`
      update public.delivery_assignments da
      set status = 'completed',
          completed_at = coalesce(completed_at, now())
      where da.rider_id = ${riderId}::uuid
        and da.batch_id = ${batchId}::uuid
        and not exists (
          select 1
          from public.delivery_batch_orders dbo
          join public.orders o on o.id = dbo.order_id
          where dbo.batch_id = da.batch_id
            and o.order_status not in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
        )
    `.execute(this.database.db);

    await sql`
      update public.delivery_batches db
      set status = 'completed',
          updated_at = now()
      where db.id = ${batchId}::uuid
        and not exists (
          select 1
          from public.delivery_batch_orders dbo
          join public.orders o on o.id = dbo.order_id
          where dbo.batch_id = db.id
            and o.order_status not in ('delivered', 'confirmed', 'administratively_completed', 'refunded')
        )
    `.execute(this.database.db);
  }

  private async listBatchOrderSummaries(
    batchId: string
  ): Promise<Omit<OrderDetail, 'items' | 'latestPayment'>[]> {
    const result = await sql<Omit<OrderDetail, 'items' | 'latestPayment'>>`
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
      join public.delivery_batch_orders dbo on dbo.order_id = o.id
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campus_locations cl on cl.id = o.location_id
      where dbo.batch_id = ${batchId}::uuid
      order by dbo.sequence nulls last, dbo.added_at
    `.execute(this.database.db);

    return result.rows;
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

  private async listSettlementLines(settlementId: string): Promise<RiderSettlementLine[]> {
    const result = await sql<RiderSettlementLine>`
      select
        sl.id::text as "id",
        sl.settlement_id::text as "settlementId",
        sl.order_id::text as "orderId",
        o.order_number as "orderNumber",
        sl.line_type as "lineType",
        sl.amount_kobo as "amountKobo",
        sl.description,
        sl.created_at::text as "createdAt"
      from public.settlement_lines sl
      left join public.orders o on o.id = sl.order_id
      where sl.settlement_id = ${settlementId}::uuid
      order by sl.created_at asc, sl.id asc
    `.execute(this.database.db);

    return result.rows;
  }
}
