import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { OrderStatus } from '../orders/orders.types.js';
import type { AdminDashboard, AdminListResult, AdminRecord } from './admin.types.js';
import type {
  AdminAnalyticsQueryDto,
  AdminAuditLogQueryDto,
  AdminBatchListQueryDto,
  AdminEscalationQueryDto,
  AdminInventoryQueryDto,
  AdminOrderListQueryDto,
  AdminRiderListQueryDto,
  AdminReviewQueryDto,
  AdminSettlementQueryDto,
  AdminUserListQueryDto,
  AdminVendorListQueryDto
} from './dto/admin.dto.js';

@Injectable()
export class AdminRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listOrders(query: AdminOrderListQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select
        o.id::text as "id",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        o.campus_id::text as "campusId",
        o.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        o.service_date::text as "serviceDate",
        o.delivery_slot_id::text as "deliverySlotId",
        o.location_id::text as "locationId",
        o.order_status::text as "orderStatus",
        o.delivery_mode::text as "deliveryMode",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      where (${campusId ?? query.campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.order_status is null or o.order_status = ${query.status ?? null}::public.order_status)
        and (${query.vendorId ?? null}::uuid is null or o.vendor_id = ${query.vendorId ?? null}::uuid)
        and (${query.slotId ?? null}::uuid is null or o.delivery_slot_id = ${query.slotId ?? null}::uuid)
        and (${query.date ?? null}::date is null or o.service_date = ${query.date ?? null}::date)
        and (${query.search ?? null}::text is null or o.order_number ilike '%' || ${query.search ?? null}::text || '%')
      order by o.created_at desc, o.id desc
      limit ${limit + 1}
    `.execute(this.database.db);

    return this.toList(result.rows, limit);
  }

  async getOrder(orderId: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select
        o.id::text as "id",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        p.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        o.order_status::text as "orderStatus",
        o.delivery_mode::text as "deliveryMode",
        o.service_date::text as "serviceDate",
        o.total_kobo as "totalKobo",
        o.currency,
        o.created_at::text as "createdAt",
        o.updated_at::text as "updatedAt"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      left join public.profiles p on p.id = o.customer_id
      where o.id = ${orderId}::uuid
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async transitionOrder(
    orderId: string,
    status: OrderStatus,
    actorUserId: string,
    reason?: string
  ): Promise<AdminRecord | undefined> {
    await sql`
      select public.transition_order_status(
        ${orderId}::uuid,
        ${status}::public.order_status,
        ${actorUserId}::uuid,
        ${reason ?? null}::text
      )
    `.execute(this.database.db);
    return this.getOrder(orderId);
  }

  async listBatches(query: AdminBatchListQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select
        db.id::text as "id",
        db.campus_id::text as "campusId",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        db.service_date::text as "serviceDate",
        db.delivery_slot_id::text as "deliverySlotId",
        db.zone_id::text as "zoneId",
        db.batch_number as "batchNumber",
        db.status::text as "status",
        db.delivery_mode::text as "deliveryMode",
        db.order_count as "orderCount",
        db.delivery_earnings_kobo as "deliveryEarningsKobo",
        db.created_at::text as "createdAt",
        db.updated_at::text as "updatedAt"
      from public.delivery_batches db
      join public.vendors v on v.id = db.vendor_id
      where (${campusId ?? query.campusId ?? null}::uuid is null or db.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.batch_status is null or db.status = ${query.status ?? null}::public.batch_status)
        and (${query.vendorId ?? null}::uuid is null or db.vendor_id = ${query.vendorId ?? null}::uuid)
        and (${query.zoneId ?? null}::uuid is null or db.zone_id = ${query.zoneId ?? null}::uuid)
        and (${query.date ?? null}::date is null or db.service_date = ${query.date ?? null}::date)
      order by db.created_at desc, db.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async getBatch(batchId: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select
        db.id::text as "id",
        db.campus_id::text as "campusId",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        db.service_date::text as "serviceDate",
        db.batch_number as "batchNumber",
        db.status::text as "status",
        db.delivery_mode::text as "deliveryMode",
        db.order_count as "orderCount",
        db.delivery_earnings_kobo as "deliveryEarningsKobo",
        da.id::text as "assignmentId",
        da.rider_id::text as "riderId",
        da.status::text as "assignmentStatus",
        db.created_at::text as "createdAt",
        db.updated_at::text as "updatedAt"
      from public.delivery_batches db
      join public.vendors v on v.id = db.vendor_id
      left join public.delivery_assignments da on da.batch_id = db.id
      where db.id = ${batchId}::uuid
        and (${campusId ?? null}::uuid is null or db.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async closeBatch(batchId: string): Promise<AdminRecord | undefined> {
    await sql`
      update public.delivery_batches
      set status = 'closed',
          closed_at = coalesce(closed_at, now()),
          updated_at = now()
      where id = ${batchId}::uuid
    `.execute(this.database.db);
    return this.getBatch(batchId);
  }

  async assignBatch(
    batchId: string,
    actorUserId: string,
    input: { riderId?: string; vendorId?: string }
  ): Promise<AdminRecord | undefined> {
    await sql`
      insert into public.delivery_assignments (batch_id, rider_id, vendor_id, assigned_by)
      values (${batchId}::uuid, ${input.riderId ?? null}::uuid, ${input.vendorId ?? null}::uuid, ${actorUserId}::uuid)
      on conflict (batch_id) do update set
        rider_id = excluded.rider_id,
        vendor_id = excluded.vendor_id,
        assigned_by = excluded.assigned_by,
        status = 'assigned',
        assigned_at = now(),
        accepted_at = null,
        picked_up_at = null,
        completed_at = null
    `.execute(this.database.db);
    await sql`update public.delivery_batches set status = 'assigned', updated_at = now() where id = ${batchId}::uuid`.execute(
      this.database.db
    );
    return this.getBatch(batchId);
  }

  async cancelAssignment(batchId: string): Promise<AdminRecord | undefined> {
    await sql`
      update public.delivery_assignments
      set status = 'cancelled'
      where batch_id = ${batchId}::uuid
    `.execute(this.database.db);
    return this.getBatch(batchId);
  }

  async listVendors(query: AdminVendorListQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select id::text as "id", campus_id::text as "campusId", legal_name as "legalName",
        display_name as "displayName", slug, status::text as "status", active,
        phone, email::text as "email", created_at::text as "createdAt", updated_at::text as "updatedAt"
      from public.vendors
      where (${campusId ?? query.campusId ?? null}::uuid is null or campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.vendor_status is null or status = ${query.status ?? null}::public.vendor_status)
        and (${query.search ?? null}::text is null or display_name ilike '%' || ${query.search ?? null}::text || '%' or legal_name ilike '%' || ${query.search ?? null}::text || '%')
      order by created_at desc, id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async createVendor(input: {
    campusId: string;
    createdByAdminId?: string;
    legalName: string;
    displayName: string;
    slug: string;
  }): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      insert into public.vendors (campus_id, legal_name, display_name, slug, created_by_admin_id)
      values (
        ${input.campusId}::uuid,
        ${input.legalName},
        ${input.displayName},
        ${input.slug},
        ${input.createdByAdminId ?? null}::uuid
      )
      returning id::text as "id", campus_id::text as "campusId", legal_name as "legalName",
        display_name as "displayName", slug, status::text as "status", active,
        created_by_admin_id::text as "createdByAdminId"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async getVendor(vendorId: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select id::text as "id", campus_id::text as "campusId", legal_name as "legalName",
        display_name as "displayName", slug, description, phone, email::text as "email",
        status::text as "status", active, created_at::text as "createdAt", updated_at::text as "updatedAt"
      from public.vendors
      where id = ${vendorId}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async updateVendor(
    vendorId: string,
    input: { displayName?: string; description?: string; phone?: string; active?: boolean }
  ): Promise<AdminRecord | undefined> {
    await sql`
      update public.vendors
      set display_name = case when ${Object.hasOwn(input, 'displayName')} then ${input.displayName ?? null} else display_name end,
          description = case when ${Object.hasOwn(input, 'description')} then ${input.description ?? null} else description end,
          phone = case when ${Object.hasOwn(input, 'phone')} then ${input.phone ?? null} else phone end,
          active = case when ${Object.hasOwn(input, 'active')} then ${input.active ?? null} else active end,
          updated_at = now()
      where id = ${vendorId}::uuid
    `.execute(this.database.db);
    return this.getVendor(vendorId);
  }

  async setVendorStatus(
    vendorId: string,
    status: 'approved' | 'pending' | 'suspended',
    actorUserId: string
  ): Promise<AdminRecord | undefined> {
    await sql`
      update public.vendors
      set status = ${status}::public.vendor_status,
          active = ${status === 'approved'},
          approved_by = case when ${status === 'approved'} then ${actorUserId}::uuid else approved_by end,
          approved_at = case when ${status === 'approved'} then coalesce(approved_at, now()) else approved_at end,
          updated_at = now()
      where id = ${vendorId}::uuid
    `.execute(this.database.db);
    return this.getVendor(vendorId);
  }

  async addVendorUser(
    vendorId: string,
    userId: string,
    role: string
  ): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      insert into public.vendor_users (vendor_id, user_id, role)
      values (${vendorId}::uuid, ${userId}::uuid, ${role}::public.vendor_user_role)
      on conflict (vendor_id, user_id) do update set role = excluded.role, active = true, updated_at = now()
      returning id::text as "id", vendor_id::text as "vendorId", user_id::text as "userId", role::text as "role", active
    `.execute(this.database.db);
    return result.rows[0];
  }

  async getVendorPerformance(vendorId: string): Promise<AdminRecord> {
    const result = await sql<AdminRecord>`
      select
        count(o.id)::integer as "orderCount",
        coalesce(sum(o.total_kobo), 0)::integer as "grossSalesKobo",
        count(r.id)::integer as "reviewCount",
        avg(r.vendor_rating)::float as "averageVendorRating"
      from public.vendors v
      left join public.orders o on o.vendor_id = v.id
      left join public.reviews r on r.vendor_id = v.id
      where v.id = ${vendorId}::uuid
      group by v.id
    `.execute(this.database.db);
    return result.rows[0] ?? {};
  }

  async listRiders(query: AdminRiderListQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select r.id::text as "id", r.campus_id::text as "campusId", r.user_id::text as "userId",
        r.display_name as "displayName", r.phone, r.status::text as "status", r.active,
        r.verified_at::text as "verifiedAt", r.created_at::text as "createdAt"
      from public.riders r
      where (${campusId ?? query.campusId ?? null}::uuid is null or r.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.rider_status is null or r.status = ${query.status ?? null}::public.rider_status)
        and (${query.search ?? null}::text is null or r.display_name ilike '%' || ${query.search ?? null}::text || '%')
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async getRider(riderId: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select id::text as "id", campus_id::text as "campusId", user_id::text as "userId",
        display_name as "displayName", phone, status::text as "status", active,
        verified_at::text as "verifiedAt", created_at::text as "createdAt", updated_at::text as "updatedAt"
      from public.riders
      where id = ${riderId}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listRiderAssignments(riderId: string, campusId?: string): Promise<AdminRecord[]> {
    const result = await sql<AdminRecord>`
      select
        da.id::text as "id",
        da.batch_id::text as "batchId",
        da.rider_id::text as "riderId",
        da.status::text as "status",
        da.assigned_at::text as "assignedAt",
        da.accepted_at::text as "acceptedAt",
        da.picked_up_at::text as "pickedUpAt",
        da.completed_at::text as "completedAt",
        db.campus_id::text as "campusId",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        db.service_date::text as "serviceDate",
        db.batch_number as "batchNumber",
        db.order_count as "orderCount"
      from public.delivery_assignments da
      join public.delivery_batches db on db.id = da.batch_id
      join public.vendors v on v.id = db.vendor_id
      where da.rider_id = ${riderId}::uuid
        and (${campusId ?? null}::uuid is null or db.campus_id = ${campusId ?? null}::uuid)
      order by da.assigned_at desc, da.id desc
      limit 100
    `.execute(this.database.db);
    return result.rows;
  }

  async listRiderSettlements(riderId: string, campusId?: string): Promise<AdminRecord[]> {
    const result = await sql<AdminRecord>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        rider_id::text as "riderId",
        settlement_date::text as "settlementDate",
        status::text as "status",
        delivery_earnings_kobo as "deliveryEarningsKobo",
        adjustments_kobo as "adjustmentsKobo",
        payable_kobo as "payableKobo",
        paid_at::text as "paidAt",
        external_reference as "externalReference",
        created_at::text as "createdAt"
      from public.settlements
      where rider_id = ${riderId}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      order by settlement_date desc, id desc
      limit 100
    `.execute(this.database.db);
    return result.rows;
  }

  async setRiderStatus(
    riderId: string,
    status: 'suspended' | 'verified',
    actorUserId: string
  ): Promise<AdminRecord | undefined> {
    await sql`
      update public.riders
      set status = ${status}::public.rider_status,
          active = ${status === 'verified'},
          verified_by = case when ${status === 'verified'} then ${actorUserId}::uuid else verified_by end,
          verified_at = case when ${status === 'verified'} then coalesce(verified_at, now()) else verified_at end,
          updated_at = now()
      where id = ${riderId}::uuid
    `.execute(this.database.db);
    return this.getRider(riderId);
  }

  async listInventory(query: AdminInventoryQueryDto, campusId?: string): Promise<AdminRecord[]> {
    const result = await sql<AdminRecord>`
      select inv.id::text as "id", mi.vendor_id::text as "vendorId", v.campus_id::text as "campusId",
        mi.name as "menuItemName", inv.service_date::text as "serviceDate", inv.delivery_slot_id::text as "deliverySlotId",
        inv.quantity_total as "quantityTotal", inv.quantity_reserved as "quantityReserved",
        inv.quantity_sold as "quantitySold", inv.quantity_adjusted as "quantityAdjusted",
        (inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold) as "remainingQuantity"
      from public.menu_item_inventory inv
      join public.menu_items mi on mi.id = inv.menu_item_id
      join public.vendors v on v.id = mi.vendor_id
      where (${campusId ?? query.campusId ?? null}::uuid is null or v.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.vendorId ?? null}::uuid is null or mi.vendor_id = ${query.vendorId ?? null}::uuid)
        and (${query.slotId ?? null}::uuid is null or inv.delivery_slot_id = ${query.slotId ?? null}::uuid)
        and (${query.date ?? null}::date is null or inv.service_date = ${query.date ?? null}::date)
        and (
          ${query.state ?? null}::text is null
          or (${query.state ?? null} = 'sold_out' and (inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold) <= 0)
          or (${query.state ?? null} = 'low' and (inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold) between 1 and 5)
          or (${query.state ?? null} = 'available' and (inv.quantity_total + inv.quantity_adjusted - inv.quantity_reserved - inv.quantity_sold) > 5)
        )
      order by inv.service_date desc, inv.created_at desc
      limit 100
    `.execute(this.database.db);
    return result.rows;
  }

  async adjustInventory(
    inventoryId: string,
    delta: number,
    reason: string,
    actorUserId: string
  ): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select public.record_inventory_adjustment(
        ${inventoryId}::uuid,
        ${delta}::integer,
        ${reason},
        ${actorUserId}::uuid,
        '{}'::jsonb
      )::text as "adjustmentId"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listEscalations(
    query: AdminEscalationQueryDto,
    campusId?: string
  ): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select e.id::text as "id", e.order_id::text as "orderId", o.campus_id::text as "campusId",
        e.opened_by::text as "openedBy", e.category, e.description, e.status::text as "status",
        e.assigned_admin_id::text as "assignedAdminId", e.opened_at::text as "openedAt"
      from public.escalations e
      join public.orders o on o.id = e.order_id
      where (${campusId ?? query.campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.escalation_status is null or e.status = ${query.status ?? null}::public.escalation_status)
        and (${query.category ?? null}::text is null or e.category = ${query.category ?? null}::text)
      order by e.opened_at desc, e.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async getEscalation(id: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select e.id::text as "id", e.order_id::text as "orderId", o.campus_id::text as "campusId",
        e.category, e.description, e.status::text as "status", e.resolution,
        e.assigned_admin_id::text as "assignedAdminId", e.refund_id::text as "refundId",
        e.opened_at::text as "openedAt", e.resolved_at::text as "resolvedAt"
      from public.escalations e
      join public.orders o on o.id = e.order_id
      where e.id = ${id}::uuid
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async updateEscalation(
    id: string,
    input: { assignedAdminId?: string; status?: string; resolution?: string; refundId?: string }
  ): Promise<AdminRecord | undefined> {
    await sql`
      update public.escalations
      set assigned_admin_id = case when ${Object.hasOwn(input, 'assignedAdminId')} then ${input.assignedAdminId ?? null}::uuid else assigned_admin_id end,
          status = case when ${Object.hasOwn(input, 'status')} then ${input.status ?? null}::public.escalation_status else status end,
          resolution = case when ${Object.hasOwn(input, 'resolution')} then ${input.resolution ?? null} else resolution end,
          refund_id = case when ${Object.hasOwn(input, 'refundId')} then ${input.refundId ?? null}::uuid else refund_id end,
          resolved_at = case when ${Object.hasOwn(input, 'resolution')} then now() else resolved_at end,
          updated_at = now()
      where id = ${id}::uuid
    `.execute(this.database.db);
    return this.getEscalation(id);
  }

  async listSettlements(
    query: AdminSettlementQueryDto,
    campusId?: string
  ): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select s.id::text as "id", s.campus_id::text as "campusId", s.vendor_id::text as "vendorId",
        s.rider_id::text as "riderId", s.settlement_date::text as "settlementDate",
        s.status::text as "status", s.payable_kobo as "payableKobo", s.paid_at::text as "paidAt",
        s.external_reference as "externalReference", s.created_at::text as "createdAt"
      from public.settlements s
      where (${campusId ?? query.campusId ?? null}::uuid is null or s.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.settlement_status is null or s.status = ${query.status ?? null}::public.settlement_status)
        and (${query.date ?? null}::date is null or s.settlement_date = ${query.date ?? null}::date)
        and (${query.beneficiaryType ?? null}::text is null or (${query.beneficiaryType ?? null} = 'vendor' and s.vendor_id is not null) or (${query.beneficiaryType ?? null} = 'rider' and s.rider_id is not null))
      order by s.settlement_date desc, s.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async getSettlement(id: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select id::text as "id", campus_id::text as "campusId", vendor_id::text as "vendorId",
        rider_id::text as "riderId", settlement_date::text as "settlementDate",
        status::text as "status", gross_food_amount_kobo as "grossFoodAmountKobo",
        delivery_earnings_kobo as "deliveryEarningsKobo", refunds_kobo as "refundsKobo",
        adjustments_kobo as "adjustmentsKobo", payable_kobo as "payableKobo",
        paid_at::text as "paidAt", external_reference as "externalReference"
      from public.settlements
      where id = ${id}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async generateSettlement(
    type: 'rider' | 'vendor',
    id: string,
    date: string,
    actorUserId: string
  ): Promise<AdminRecord | undefined> {
    const result =
      type === 'vendor'
        ? await sql<AdminRecord>`select public.produce_vendor_daily_settlement(${id}::uuid, ${date}::date, ${actorUserId}::uuid)::text as "settlementId"`.execute(
            this.database.db
          )
        : await sql<AdminRecord>`select public.produce_rider_daily_settlement(${id}::uuid, ${date}::date, ${actorUserId}::uuid)::text as "settlementId"`.execute(
            this.database.db
          );
    return result.rows[0];
  }

  async previewSettlement(
    type: 'rider' | 'vendor',
    id: string,
    date: string
  ): Promise<AdminRecord> {
    if (type === 'vendor') {
      const result = await sql<AdminRecord>`
        select
          ${type}::text as "beneficiaryType",
          ${id}::text as "beneficiaryId",
          ${date}::text as "settlementDate",
          coalesce(sum(o.food_subtotal_kobo), 0)::integer as "grossFoodAmountKobo",
          coalesce(sum(o.delivery_fee_kobo) filter (where o.delivery_mode = 'vendor_delivery'), 0)::integer as "deliveryEarningsKobo",
          coalesce(sum(r.amount_kobo), 0)::integer as "refundsKobo",
          greatest(
            coalesce(sum(o.food_subtotal_kobo), 0)
            + coalesce(sum(o.delivery_fee_kobo) filter (where o.delivery_mode = 'vendor_delivery'), 0)
            - coalesce(sum(r.amount_kobo), 0),
            0
          )::integer as "estimatedPayableKobo"
        from public.vendors v
        left join public.orders o on o.vendor_id = v.id
          and o.service_date = ${date}::date
          and o.order_status in ('delivered', 'administratively_completed')
        left join public.refunds r on r.order_id = o.id and r.status = 'succeeded'
        where v.id = ${id}::uuid
        group by v.id
      `.execute(this.database.db);
      return result.rows[0] ?? {};
    }

    const result = await sql<AdminRecord>`
      select
        ${type}::text as "beneficiaryType",
        ${id}::text as "beneficiaryId",
        ${date}::text as "settlementDate",
        coalesce(sum(db.delivery_earnings_kobo), 0)::integer as "deliveryEarningsKobo",
        coalesce(sum(db.delivery_earnings_kobo), 0)::integer as "estimatedPayableKobo"
      from public.riders r
      left join public.delivery_assignments da on da.rider_id = r.id and da.status = 'completed'
      left join public.delivery_batches db on db.id = da.batch_id and db.service_date = ${date}::date
      where r.id = ${id}::uuid
      group by r.id
    `.execute(this.database.db);
    return result.rows[0] ?? {};
  }

  async setSettlementStatus(
    id: string,
    status: 'approved' | 'paid',
    actorUserId: string,
    externalReference?: string
  ): Promise<AdminRecord | undefined> {
    await sql`
      update public.settlements
      set status = ${status}::public.settlement_status,
          approved_by = case when ${status === 'approved'} then ${actorUserId}::uuid else approved_by end,
          paid_at = case when ${status === 'paid'} then coalesce(paid_at, now()) else paid_at end,
          external_reference = coalesce(${externalReference ?? null}, external_reference),
          updated_at = now()
      where id = ${id}::uuid
    `.execute(this.database.db);
    return this.getSettlement(id);
  }

  async adjustSettlement(
    id: string,
    amountKobo: number,
    description: string
  ): Promise<AdminRecord | undefined> {
    await this.database.db.transaction().execute(async (trx) => {
      await sql`
        update public.settlements
        set adjustments_kobo = adjustments_kobo + ${amountKobo},
            payable_kobo = payable_kobo + ${amountKobo},
            updated_at = now()
        where id = ${id}::uuid
      `.execute(trx);
      await sql`
        insert into public.settlement_lines (settlement_id, line_type, amount_kobo, description)
        values (${id}::uuid, 'adjustment', ${amountKobo}, ${description})
      `.execute(trx);
    });
    return this.getSettlement(id);
  }

  async listReviews(query: AdminReviewQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select r.id::text as "id", r.order_id::text as "orderId", o.campus_id::text as "campusId",
        r.vendor_id::text as "vendorId", r.food_rating as "foodRating", r.vendor_rating as "vendorRating",
        r.delivery_rating as "deliveryRating", r.comment, r.moderation_status::text as "moderationStatus",
        r.created_at::text as "createdAt"
      from public.reviews r
      join public.orders o on o.id = r.order_id
      where (${campusId ?? query.campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.review_moderation_status is null or r.moderation_status = ${query.status ?? null}::public.review_moderation_status)
        and (${query.vendorId ?? null}::uuid is null or r.vendor_id = ${query.vendorId ?? null}::uuid)
        and (${query.rating ?? null}::integer is null or r.food_rating = ${query.rating ?? null} or r.vendor_rating = ${query.rating ?? null} or r.delivery_rating = ${query.rating ?? null})
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async moderateReview(reviewId: string, status: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      update public.reviews
      set moderation_status = ${status}::public.review_moderation_status,
          updated_at = now()
      where id = ${reviewId}::uuid
      returning id::text as "id", moderation_status::text as "moderationStatus"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listUsers(query: AdminUserListQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select p.id::text as "id", p.display_name as "displayName", p.email::text as "email",
        p.phone_number as "phoneNumber", p.account_status::text as "accountStatus",
        p.default_campus_id::text as "defaultCampusId", p.created_at::text as "createdAt"
      from public.profiles p
      where (${campusId ?? query.campusId ?? null}::uuid is null or p.default_campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.status ?? null}::public.account_status is null or p.account_status = ${query.status ?? null}::public.account_status)
        and (${query.search ?? null}::text is null or p.email::text ilike '%' || ${query.search ?? null}::text || '%' or p.display_name ilike '%' || ${query.search ?? null}::text || '%')
      order by p.created_at desc, p.id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  async getUser(userId: string, campusId?: string): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      select id::text as "id", display_name as "displayName", email::text as "email",
        phone_number as "phoneNumber", account_status::text as "accountStatus",
        default_campus_id::text as "defaultCampusId", created_at::text as "createdAt"
      from public.profiles
      where id = ${userId}::uuid
        and (${campusId ?? null}::uuid is null or default_campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async setUserStatus(userId: string, status: string): Promise<AdminRecord | undefined> {
    await sql`update public.profiles set account_status = ${status}::public.account_status, updated_at = now() where id = ${userId}::uuid`.execute(
      this.database.db
    );
    return this.getUser(userId);
  }

  async listAdminMemberships(): Promise<AdminRecord[]> {
    const result = await sql<AdminRecord>`
      select id::text as "id", user_id::text as "userId", campus_id::text as "campusId",
        role::text as "role", active, granted_at::text as "grantedAt", revoked_at::text as "revokedAt"
      from public.admin_memberships
      order by granted_at desc
    `.execute(this.database.db);
    return result.rows;
  }

  async createAdminMembership(
    input: { userId: string; role: string; campusId?: string },
    actorUserId: string
  ): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      insert into public.admin_memberships (user_id, campus_id, role, granted_by)
      values (${input.userId}::uuid, ${input.campusId ?? null}::uuid, ${input.role}::public.admin_role, ${actorUserId}::uuid)
      returning id::text as "id", user_id::text as "userId", campus_id::text as "campusId", role::text as "role", active
    `.execute(this.database.db);
    return result.rows[0];
  }

  async setAdminMembershipActive(id: string, active: boolean): Promise<AdminRecord | undefined> {
    const result = await sql<AdminRecord>`
      update public.admin_memberships
      set active = ${active},
          revoked_at = case when ${active} then null else coalesce(revoked_at, now()) end
      where id = ${id}::uuid
      returning id::text as "id", user_id::text as "userId", campus_id::text as "campusId", role::text as "role", active
    `.execute(this.database.db);
    return result.rows[0];
  }

  async getDashboard(campusId: string | undefined, date: string): Promise<AdminDashboard> {
    const [orders, batches, payments, escalations, settlements] = await Promise.all([
      sql<AdminRecord>`select count(*)::integer as "total", count(*) filter (where order_status = 'paid')::integer as "paid" from public.orders where (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid) and service_date = ${date}::date`.execute(
        this.database.db
      ),
      sql<AdminRecord>`select count(*)::integer as "total", count(*) filter (where status = 'open')::integer as "open" from public.delivery_batches where (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid) and service_date = ${date}::date`.execute(
        this.database.db
      ),
      sql<AdminRecord>`select count(*)::integer as "total", count(*) filter (where p.status = 'failed')::integer as "failed" from public.payments p join public.orders o on o.id = p.order_id where (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)`.execute(
        this.database.db
      ),
      sql<AdminRecord>`select count(*)::integer as "open" from public.escalations e join public.orders o on o.id = e.order_id where (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid) and e.status = 'open'`.execute(
        this.database.db
      ),
      sql<AdminRecord>`select coalesce(sum(payable_kobo), 0)::integer as "payableKobo" from public.settlements where (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid) and status in ('draft', 'approved')`.execute(
        this.database.db
      )
    ]);
    return {
      alerts: [],
      batches: batches.rows[0] ?? {},
      campusId: campusId ?? null,
      date,
      escalations: escalations.rows[0] ?? {},
      orders: orders.rows[0] ?? {},
      payments: payments.rows[0] ?? {},
      settlements: settlements.rows[0] ?? {}
    };
  }

  async getAnalytics(query: AdminAnalyticsQueryDto, campusId?: string): Promise<AdminRecord> {
    const result = await sql<AdminRecord>`
      select
        count(o.id)::integer as "orderCount",
        coalesce(sum(o.total_kobo), 0)::integer as "grossSalesKobo",
        count(distinct o.vendor_id)::integer as "activeVendorCount"
      from public.orders o
      where (${campusId ?? query.campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.dateFrom ?? null}::date is null or o.service_date >= ${query.dateFrom ?? null}::date)
        and (${query.dateTo ?? null}::date is null or o.service_date <= ${query.dateTo ?? null}::date)
    `.execute(this.database.db);
    return result.rows[0] ?? {};
  }

  async listAuditLogs(query: AdminAuditLogQueryDto, campusId?: string): Promise<AdminListResult> {
    const limit = query.limit ?? 20;
    const result = await sql<AdminRecord>`
      select id::text as "id", actor_user_id::text as "actorUserId", campus_id::text as "campusId",
        action, entity_type as "entityType", entity_id::text as "entityId", request_id as "requestId",
        created_at::text as "createdAt"
      from public.audit_logs
      where (${campusId ?? query.campusId ?? null}::uuid is null or campus_id = ${campusId ?? query.campusId ?? null}::uuid)
        and (${query.actorId ?? null}::uuid is null or actor_user_id = ${query.actorId ?? null}::uuid)
        and (${query.action ?? null}::text is null or action = ${query.action ?? null})
        and (${query.entityType ?? null}::text is null or entity_type = ${query.entityType ?? null})
        and (${query.entityId ?? null}::uuid is null or entity_id = ${query.entityId ?? null}::uuid)
        and (${query.requestId ?? null}::text is null or request_id = ${query.requestId ?? null})
      order by created_at desc, id desc
      limit ${limit + 1}
    `.execute(this.database.db);
    return this.toList(result.rows, limit);
  }

  private toList(rows: AdminRecord[], limit: number): AdminListResult {
    return {
      hasMore: rows.length > limit,
      items: rows.slice(0, limit),
      limit
    };
  }
}
