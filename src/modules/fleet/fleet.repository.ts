import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  FleetBatch,
  FleetMember,
  FleetMemberRole,
  FleetMembership,
  FleetPartner,
  FleetPartnerCreateInput,
  FleetPartnerListFilters,
  FleetPartnerUpdateInput,
  FleetRider,
  FleetRiderEarnings,
  FleetRiderListFilters,
  FleetRiderRef,
  RiderFleet
} from './fleet.types.js';

// Shared select list for FleetPartner. Counts are cheap correlated subqueries: a campus has
// a handful of partners, each with tens of riders.
const partnerColumns = sql`
  fp.id::text as "id",
  fp.campus_id::text as "campusId",
  c.name as "campusName",
  fp.name,
  fp.contact_name as "contactName",
  fp.contact_phone as "contactPhone",
  fp.contact_email::text as "contactEmail",
  fp.status::text as "status",
  fp.join_code as "joinCode",
  fp.commission_bps as "commissionBps",
  fp.can_dispatch as "canDispatch",
  fp.dispatch_priority as "dispatchPriority",
  (select count(*)::integer from public.riders r where r.fleet_partner_id = fp.id) as "riderCount",
  (
    select count(*)::integer
    from public.fleet_partner_members m
    where m.fleet_partner_id = fp.id and m.active
  ) as "activeManagerCount",
  fp.created_at::text as "createdAt",
  fp.updated_at::text as "updatedAt"
`;

@Injectable()
export class FleetRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listPartners(filters: FleetPartnerListFilters): Promise<FleetPartner[]> {
    const result = await sql<FleetPartner>`
      select ${partnerColumns}
      from public.fleet_partners fp
      join public.campuses c on c.id = fp.campus_id
      where (${filters.campusId ?? null}::uuid is null or fp.campus_id = ${filters.campusId ?? null}::uuid)
        and (${filters.status ?? null}::public.fleet_partner_status is null or fp.status = ${filters.status ?? null}::public.fleet_partner_status)
      order by c.name asc, fp.name asc
    `.execute(this.database.db);
    return result.rows;
  }

  async getPartner(partnerId: string): Promise<FleetPartner | undefined> {
    const result = await sql<FleetPartner>`
      select ${partnerColumns}
      from public.fleet_partners fp
      join public.campuses c on c.id = fp.campus_id
      where fp.id = ${partnerId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findPartnerIdByJoinCode(joinCode: string): Promise<string | undefined> {
    const result = await sql<{ id: string }>`
      select id::text as "id"
      from public.fleet_partners
      where join_code = ${joinCode}
    `.execute(this.database.db);
    return result.rows[0]?.id;
  }

  async createPartner(
    input: FleetPartnerCreateInput,
    joinCode: string,
    createdBy: string
  ): Promise<string> {
    const result = await sql<{ id: string }>`
      insert into public.fleet_partners (
        campus_id, name, contact_name, contact_phone, contact_email, join_code,
        commission_bps, can_dispatch, dispatch_priority, created_by
      )
      values (
        ${input.campusId}::uuid,
        ${input.name},
        ${input.contactName ?? null},
        ${input.contactPhone ?? null},
        ${input.contactEmail ?? null}::extensions.citext,
        ${joinCode},
        ${input.commissionBps ?? 0},
        ${input.canDispatch ?? true},
        ${input.dispatchPriority ?? 0},
        ${createdBy}::uuid
      )
      returning id::text as "id"
    `.execute(this.database.db);

    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('Fleet partner insert did not return a row.');
    }
    return id;
  }

  async updatePartner(partnerId: string, input: FleetPartnerUpdateInput): Promise<boolean> {
    const has = (key: keyof FleetPartnerUpdateInput): boolean => Object.hasOwn(input, key);

    const result = await sql<{ id: string }>`
      update public.fleet_partners
      set
        name = case when ${has('name')} then ${input.name ?? null} else name end,
        contact_name = case when ${has('contactName')} then ${input.contactName ?? null} else contact_name end,
        contact_phone = case when ${has('contactPhone')} then ${input.contactPhone ?? null} else contact_phone end,
        contact_email = case when ${has('contactEmail')} then ${input.contactEmail ?? null}::extensions.citext else contact_email end,
        commission_bps = case when ${has('commissionBps')} then ${input.commissionBps ?? null}::integer else commission_bps end,
        can_dispatch = case when ${has('canDispatch')} then ${input.canDispatch ?? null}::boolean else can_dispatch end,
        dispatch_priority = case when ${has('dispatchPriority')} then ${input.dispatchPriority ?? null}::integer else dispatch_priority end,
        status = case when ${has('status')} then ${input.status ?? null}::public.fleet_partner_status else status end
      where id = ${partnerId}::uuid
      returning id::text as "id"
    `.execute(this.database.db);
    return result.rows.length > 0;
  }

  async setJoinCode(partnerId: string, joinCode: string): Promise<void> {
    await sql`
      update public.fleet_partners
      set join_code = ${joinCode}
      where id = ${partnerId}::uuid
    `.execute(this.database.db);
  }

  /**
   * Take a suspended or deactivated fleet's riders off shift so nobody keeps showing as
   * available for work they cannot get. Auto-dispatch already skips them; this keeps the
   * rider app and admin views honest.
   */
  async markFleetRidersUnavailable(partnerId: string): Promise<void> {
    await sql`
      update public.riders
      set available = false
      where fleet_partner_id = ${partnerId}::uuid
        and available
    `.execute(this.database.db);
  }

  async listMembershipsForUser(userId: string): Promise<FleetMembership[]> {
    const result = await sql<FleetMembership>`
      select
        fp.id::text as "fleetPartnerId",
        fp.name,
        fp.campus_id::text as "campusId",
        c.name as "campusName",
        fp.status::text as "status",
        fp.can_dispatch as "canDispatch",
        m.role
      from public.fleet_partner_members m
      join public.fleet_partners fp on fp.id = m.fleet_partner_id
      join public.campuses c on c.id = fp.campus_id
      where m.user_id = ${userId}::uuid
        and m.active
        and fp.status <> 'deactivated'
      order by fp.name asc
    `.execute(this.database.db);
    return result.rows;
  }

  async findActiveMemberRole(
    userId: string,
    partnerId: string
  ): Promise<FleetMemberRole | undefined> {
    const result = await sql<{ role: FleetMemberRole }>`
      select role
      from public.fleet_partner_members
      where user_id = ${userId}::uuid
        and fleet_partner_id = ${partnerId}::uuid
        and active
    `.execute(this.database.db);
    return result.rows[0]?.role;
  }

  async listMembers(partnerId: string): Promise<FleetMember[]> {
    const result = await sql<FleetMember>`
      select
        m.id::text as "id",
        m.fleet_partner_id::text as "fleetPartnerId",
        m.user_id::text as "userId",
        p.email::text as "email",
        p.display_name as "displayName",
        m.role,
        m.active,
        m.created_at::text as "createdAt"
      from public.fleet_partner_members m
      join public.profiles p on p.id = m.user_id
      where m.fleet_partner_id = ${partnerId}::uuid
      order by m.active desc, m.created_at asc
    `.execute(this.database.db);
    return result.rows;
  }

  /** Grant (or re-activate) a manager. Re-granting a removed manager restores the row. */
  async upsertMember(
    partnerId: string,
    userId: string,
    role: FleetMemberRole,
    grantedBy: string
  ): Promise<{ created: boolean }> {
    const result = await sql<{ created: boolean }>`
      insert into public.fleet_partner_members (fleet_partner_id, user_id, role, granted_by)
      values (${partnerId}::uuid, ${userId}::uuid, ${role}, ${grantedBy}::uuid)
      on conflict (fleet_partner_id, user_id) do update set
        role = excluded.role,
        active = true,
        granted_by = excluded.granted_by
      where not public.fleet_partner_members.active
      returning (xmax = 0) as "created"
    `.execute(this.database.db);
    // No row back means the user is already an active manager of this fleet.
    const row = result.rows[0];
    if (row === undefined) {
      throw Object.assign(new Error('Already an active fleet manager.'), { code: '23505' });
    }
    return row;
  }

  async deactivateMember(partnerId: string, userId: string): Promise<boolean> {
    const result = await sql<{ id: string }>`
      update public.fleet_partner_members
      set active = false
      where fleet_partner_id = ${partnerId}::uuid
        and user_id = ${userId}::uuid
        and active
      returning id::text as "id"
    `.execute(this.database.db);
    return result.rows.length > 0;
  }

  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const result = await sql<{ id: string }>`
      select id::text as "id"
      from public.profiles
      where email = ${email}::extensions.citext
      limit 1
    `.execute(this.database.db);
    return result.rows[0]?.id;
  }

  /** Same guarantee as AdminRepository.ensureProfile, for freshly invited fleet managers. */
  async ensureProfile(userId: string, email: string): Promise<void> {
    await sql`
      insert into public.profiles (id, email, last_seen_at)
      values (${userId}::uuid, ${email}::extensions.citext, now())
      on conflict (id) do nothing
    `.execute(this.database.db);
  }

  async listRiders(partnerId: string, filters: FleetRiderListFilters): Promise<FleetRider[]> {
    const result = await sql<FleetRider>`
      select
        r.id::text as "id",
        r.campus_id::text as "campusId",
        r.display_name as "displayName",
        r.phone,
        r.status::text as "status",
        r.active,
        r.available,
        (
          select count(*)::integer
          from public.delivery_assignments da
          where da.rider_id = r.id and da.status in ('assigned', 'accepted', 'picked_up')
        ) as "openAssignmentCount",
        r.created_at::text as "createdAt"
      from public.riders r
      where r.fleet_partner_id = ${partnerId}::uuid
        and (${filters.status ?? null}::public.rider_status is null or r.status = ${filters.status ?? null}::public.rider_status)
        and (${filters.available ?? null}::boolean is null or r.available = ${filters.available ?? null}::boolean)
      order by r.display_name asc, r.id asc
    `.execute(this.database.db);
    return result.rows;
  }

  async findRiderById(riderId: string): Promise<FleetRiderRef | undefined> {
    const result = await sql<FleetRiderRef>`
      select
        id::text as "id",
        user_id::text as "userId",
        campus_id::text as "campusId",
        fleet_partner_id::text as "fleetPartnerId"
      from public.riders
      where id = ${riderId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  /** Same lookup order as RidersRepository.findRiderProfileForActor. */
  async findRiderForUser(userId: string, riderId?: string): Promise<FleetRiderRef | undefined> {
    const result = await sql<FleetRiderRef>`
      select
        id::text as "id",
        user_id::text as "userId",
        campus_id::text as "campusId",
        fleet_partner_id::text as "fleetPartnerId"
      from public.riders
      where user_id = ${userId}::uuid
        and (${riderId ?? null}::uuid is null or id = ${riderId ?? null}::uuid)
      order by active desc, created_at desc
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  /**
   * Move a rider into or out of a fleet. The rider is always taken off shift: joining a
   * fleet or being released from one is a change of employer, so the rider must opt back in.
   * `expectedPartnerId` makes the write conditional on the current membership so a
   * concurrent move is not silently overwritten.
   */
  async setRiderFleet(
    riderId: string,
    partnerId: string | null,
    expectedPartnerId: string | null
  ): Promise<boolean> {
    const result = await sql<{ id: string }>`
      update public.riders
      set fleet_partner_id = ${partnerId}::uuid,
          available = false
      where id = ${riderId}::uuid
        and fleet_partner_id is not distinct from ${expectedPartnerId}::uuid
      returning id::text as "id"
    `.execute(this.database.db);
    return result.rows.length > 0;
  }

  async getRiderFleet(partnerId: string): Promise<RiderFleet | undefined> {
    const result = await sql<RiderFleet>`
      select
        id::text as "fleetPartnerId",
        name,
        status::text as "status",
        contact_name as "contactName",
        contact_phone as "contactPhone"
      from public.fleet_partners
      where id = ${partnerId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  /**
   * Batches a fleet can see on a service date: rider-delivered batches on the partner's
   * campus that are unassigned (or whose assignment was cancelled) or are assigned to one
   * of this fleet's riders. Batches held by platform riders or other fleets stay hidden.
   */
  async listBatches(
    partnerId: string,
    campusId: string,
    serviceDate: string,
    batchId?: string
  ): Promise<FleetBatch[]> {
    const result = await sql<FleetBatch>`
      select
        db.id::text as "id",
        db.batch_number as "batchNumber",
        db.service_date::text as "serviceDate",
        db.status::text as "status",
        db.vendor_id::text as "vendorId",
        v.display_name as "vendorDisplayName",
        db.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        ds.delivery_time::text as "deliveryTime",
        db.zone_id::text as "zoneId",
        cz.name as "zoneName",
        db.order_count as "orderCount",
        db.delivery_earnings_kobo as "deliveryEarningsKobo",
        case when da.status <> 'cancelled' then da.id::text end as "assignmentId",
        case when da.status <> 'cancelled' then da.status::text end as "assignmentStatus",
        case when da.status <> 'cancelled' then da.rider_id::text end as "riderId",
        case when da.status <> 'cancelled' then r.display_name end as "riderDisplayName"
      from public.delivery_batches db
      join public.vendors v on v.id = db.vendor_id
      join public.delivery_slots ds on ds.id = db.delivery_slot_id
      join public.campus_zones cz on cz.id = db.zone_id
      left join public.delivery_assignments da on da.batch_id = db.id
      left join public.riders r on r.id = da.rider_id
      where db.campus_id = ${campusId}::uuid
        and db.delivery_mode = 'meal_direct_rider'
        and (
          (${batchId ?? null}::uuid is null and db.service_date = ${serviceDate}::date)
          or db.id = ${batchId ?? null}::uuid
        )
        and (
          da.id is null
          or da.status = 'cancelled'
          or da.fleet_partner_id = ${partnerId}::uuid
        )
      order by ds.delivery_time asc, cz.name asc, db.batch_number asc
    `.execute(this.database.db);
    return result.rows;
  }

  async assignBatch(
    partnerId: string,
    batchId: string,
    riderId: string,
    actorUserId: string
  ): Promise<string> {
    const result = await sql<{ assignmentId: string }>`
      select public.fleet_assign_batch(
        ${partnerId}::uuid,
        ${batchId}::uuid,
        ${riderId}::uuid,
        ${actorUserId}::uuid
      )::text as "assignmentId"
    `.execute(this.database.db);

    const assignmentId = result.rows[0]?.assignmentId;
    if (assignmentId === undefined) {
      throw new Error('fleet_assign_batch did not return an assignment.');
    }
    return assignmentId;
  }

  /**
   * Delivery earnings per rider for work done while delivering for this fleet. Attribution
   * uses the assignment's fleet snapshot, so a rider who has since left still counts here
   * for the batches it delivered for the fleet.
   */
  async listRiderEarnings(
    partnerId: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<FleetRiderEarnings[]> {
    const result = await sql<FleetRiderEarnings>`
      select
        r.id::text as "riderId",
        r.display_name as "displayName",
        count(o.id)::integer as "deliveredOrderCount",
        coalesce(sum(o.rider_delivery_share_kobo), 0)::integer as "totalAmountKobo",
        coalesce(sum(o.rider_delivery_share_kobo) filter (where s.status = 'paid'), 0)::integer as "settledAmountKobo"
      from public.delivery_assignments da
      join public.riders r on r.id = da.rider_id
      join public.delivery_batches db on db.id = da.batch_id
      join public.delivery_batch_orders dbo on dbo.batch_id = db.id
      join public.orders o on o.id = dbo.order_id
      left join public.settlements s on s.rider_id = da.rider_id and s.settlement_date = db.service_date
      where da.fleet_partner_id = ${partnerId}::uuid
        and da.status <> 'cancelled'
        and o.delivery_mode = 'meal_direct_rider'
        and o.order_status in ('delivered', 'administratively_completed')
        and (${dateFrom ?? null}::date is null or db.service_date >= ${dateFrom ?? null}::date)
        and (${dateTo ?? null}::date is null or db.service_date <= ${dateTo ?? null}::date)
      group by r.id, r.display_name
      order by "totalAmountKobo" desc, r.display_name asc
    `.execute(this.database.db);
    return result.rows;
  }
}
