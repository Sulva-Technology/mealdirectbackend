import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  LocationFixInput,
  MapPoint,
  OrderTrackingContext,
  RiderMapEntry,
  StoredRiderLocation,
  TrackingAssignment,
  TrackingDropoffOrder,
  TrackingRider
} from './tracking.types.js';

// Orders a rider still has to hand over. Delivered, cancelled, and refunded orders drop off
// the route as soon as their status changes.
const openDropoffStatuses = ['paid', 'ready', 'out_for_delivery'];

@Injectable()
export class TrackingRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** Same lookup order as RidersRepository.findRiderProfileForActor. */
  async findRiderForUser(userId: string, riderId?: string): Promise<TrackingRider | undefined> {
    const result = await sql<TrackingRider>`
      select
        r.id::text as "id",
        r.campus_id::text as "campusId",
        r.display_name as "displayName",
        r.status::text as "status",
        r.active,
        r.available,
        (
          select count(*)::integer
          from public.delivery_assignments da
          where da.rider_id = r.id and da.status in ('assigned', 'accepted', 'picked_up')
        ) as "openAssignmentCount"
      from public.riders r
      where r.user_id = ${userId}::uuid
        and (${riderId ?? null}::uuid is null or r.id = ${riderId ?? null}::uuid)
      order by r.active desc, r.created_at desc
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  /**
   * Store a fix unless a newer one is already stored (out-of-order delivery from a phone
   * that was offline). Returns whether the fix was kept.
   */
  async upsertRiderLocation(
    riderId: string,
    fix: LocationFixInput & { recordedAt: string }
  ): Promise<boolean> {
    const result = await sql<{ riderId: string }>`
      insert into public.rider_locations (
        rider_id, latitude, longitude, accuracy_m, heading_deg, speed_mps, recorded_at
      )
      values (
        ${riderId}::uuid,
        ${fix.latitude},
        ${fix.longitude},
        ${fix.accuracyMeters ?? null}::integer,
        ${fix.headingDegrees ?? null}::integer,
        ${fix.speedMps ?? null}::numeric,
        ${fix.recordedAt}::timestamptz
      )
      on conflict (rider_id) do update set
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_m = excluded.accuracy_m,
        heading_deg = excluded.heading_deg,
        speed_mps = excluded.speed_mps,
        recorded_at = excluded.recorded_at,
        received_at = now()
      where public.rider_locations.recorded_at < excluded.recorded_at
      returning rider_id::text as "riderId"
    `.execute(this.database.db);
    return result.rows.length > 0;
  }

  async deleteRiderLocation(riderId: string): Promise<void> {
    await sql`delete from public.rider_locations where rider_id = ${riderId}::uuid`.execute(
      this.database.db
    );
  }

  async getRiderLocation(riderId: string): Promise<StoredRiderLocation | undefined> {
    const result = await sql<StoredRiderLocation>`
      select
        rider_id::text as "riderId",
        latitude::double precision as "latitude",
        longitude::double precision as "longitude",
        accuracy_m as "accuracyMeters",
        heading_deg as "headingDegrees",
        speed_mps::double precision as "speedMps",
        recorded_at::text as "recordedAt",
        received_at::text as "receivedAt"
      from public.rider_locations
      where rider_id = ${riderId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findAssignment(assignmentId: string): Promise<TrackingAssignment | undefined> {
    const result = await sql<TrackingAssignment>`
      select
        da.id::text as "id",
        da.batch_id::text as "batchId",
        da.rider_id::text as "riderId",
        da.status::text as "status",
        v.id::text as "vendorId",
        v.display_name as "vendorName",
        v.latitude::double precision as "vendorLatitude",
        v.longitude::double precision as "vendorLongitude"
      from public.delivery_assignments da
      join public.delivery_batches db on db.id = da.batch_id
      join public.vendors v on v.id = db.vendor_id
      where da.id = ${assignmentId}::uuid
        and da.rider_id is not null
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listOpenDropoffs(batchId: string): Promise<TrackingDropoffOrder[]> {
    const result = await sql<TrackingDropoffOrder>`
      select
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.order_status::text as "orderStatus",
        cl.id::text as "locationId",
        cl.name as "locationName",
        cl.latitude::double precision as "latitude",
        cl.longitude::double precision as "longitude"
      from public.delivery_batch_orders dbo
      join public.orders o on o.id = dbo.order_id
      join public.campus_locations cl on cl.id = o.location_id
      where dbo.batch_id = ${batchId}::uuid
        and o.order_status::text = any(${openDropoffStatuses}::text[])
      order by cl.name asc, o.order_number asc
    `.execute(this.database.db);
    return result.rows;
  }

  /** The order, its drop-off pin, and its rider assignment, if the caller owns the order. */
  async findOrderTrackingContext(
    orderId: string,
    customerId: string
  ): Promise<OrderTrackingContext | undefined> {
    const result = await sql<OrderTrackingContext>`
      select
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.order_status::text as "orderStatus",
        o.delivery_mode::text as "deliveryMode",
        cl.id::text as "locationId",
        cl.name as "locationName",
        cl.latitude::double precision as "latitude",
        cl.longitude::double precision as "longitude",
        da.id::text as "assignmentId",
        da.status::text as "assignmentStatus",
        r.id::text as "riderId",
        r.display_name as "riderDisplayName"
      from public.orders o
      join public.campus_locations cl on cl.id = o.location_id
      left join public.delivery_batch_orders dbo on dbo.order_id = o.id
      left join public.delivery_assignments da
        on da.batch_id = dbo.batch_id and da.status <> 'cancelled' and da.rider_id is not null
      left join public.riders r on r.id = da.rider_id
      where o.id = ${orderId}::uuid
        and o.customer_id = ${customerId}::uuid
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  /**
   * Riders currently sharing a location, for admin and fleet maps. A rider only has a row
   * while on shift or mid-delivery (the row is deleted when they go off duty).
   */
  async listRiderPositions(
    filters: { campusId?: string; fleetPartnerId?: string },
    staleAfterSeconds: number
  ): Promise<RiderMapEntry[]> {
    const result = await sql<RiderMapEntry>`
      select
        r.id::text as "riderId",
        r.display_name as "displayName",
        r.phone,
        r.campus_id::text as "campusId",
        r.available,
        r.fleet_partner_id::text as "fleetPartnerId",
        fp.name as "fleetPartnerName",
        (
          select count(*)::integer
          from public.delivery_assignments da
          where da.rider_id = r.id and da.status in ('assigned', 'accepted', 'picked_up')
        ) as "openAssignmentCount",
        rl.latitude::double precision as "latitude",
        rl.longitude::double precision as "longitude",
        rl.accuracy_m as "accuracyMeters",
        rl.heading_deg as "headingDegrees",
        rl.speed_mps::double precision as "speedMps",
        rl.recorded_at::text as "recordedAt",
        rl.recorded_at < now() - make_interval(secs => ${staleAfterSeconds}) as "stale"
      from public.rider_locations rl
      join public.riders r on r.id = rl.rider_id
      left join public.fleet_partners fp on fp.id = r.fleet_partner_id
      where (${filters.campusId ?? null}::uuid is null or r.campus_id = ${filters.campusId ?? null}::uuid)
        and (${filters.fleetPartnerId ?? null}::uuid is null or r.fleet_partner_id = ${filters.fleetPartnerId ?? null}::uuid)
      order by r.display_name asc, r.id asc
    `.execute(this.database.db);
    return result.rows;
  }

  async listMapPoints(campusId: string): Promise<MapPoint[]> {
    const result = await sql<MapPoint>`
      select
        cl.id::text as "id",
        'location' as "kind",
        cl.name,
        cl.zone_id::text as "zoneId",
        cl.active,
        cl.latitude::double precision as "latitude",
        cl.longitude::double precision as "longitude"
      from public.campus_locations cl
      where cl.campus_id = ${campusId}::uuid
      union all
      select
        v.id::text as "id",
        'vendor' as "kind",
        v.display_name as "name",
        null as "zoneId",
        v.active,
        v.latitude::double precision as "latitude",
        v.longitude::double precision as "longitude"
      from public.vendors v
      where v.campus_id = ${campusId}::uuid
      order by "kind" asc, "name" asc
    `.execute(this.database.db);
    return result.rows;
  }

  async findPointCampus(kind: MapPoint['kind'], id: string): Promise<string | undefined> {
    const result =
      kind === 'location'
        ? await sql<{ campusId: string }>`
            select campus_id::text as "campusId" from public.campus_locations where id = ${id}::uuid
          `.execute(this.database.db)
        : await sql<{ campusId: string }>`
            select campus_id::text as "campusId" from public.vendors where id = ${id}::uuid
          `.execute(this.database.db);
    return result.rows[0]?.campusId;
  }

  async setPointCoordinates(
    kind: MapPoint['kind'],
    id: string,
    coordinates: { latitude: number; longitude: number } | null
  ): Promise<void> {
    const latitude = coordinates?.latitude ?? null;
    const longitude = coordinates?.longitude ?? null;
    if (kind === 'location') {
      await sql`
        update public.campus_locations
        set latitude = ${latitude}::numeric, longitude = ${longitude}::numeric, updated_at = now()
        where id = ${id}::uuid
      `.execute(this.database.db);
    } else {
      await sql`
        update public.vendors
        set latitude = ${latitude}::numeric, longitude = ${longitude}::numeric, updated_at = now()
        where id = ${id}::uuid
      `.execute(this.database.db);
    }
  }
}
