import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CampusDirectoryRepositoryContract,
  CampusLocationRecord,
  CampusRecord,
  CampusZoneRecord,
  CreateCampusInput,
  CreateDeliverySlotInput,
  CreateLocationInput,
  CreateZoneInput,
  DeliverySlotRecord,
  UpdateCampusInput,
  UpdateDeliverySlotInput,
  UpdateLocationInput,
  UpdateZoneInput
} from './campus-directory.types.js';

@Injectable()
export class CampusDirectoryRepository implements CampusDirectoryRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listPublicCampuses(): Promise<CampusRecord[]> {
    const result = await sql<CampusRecord>`
      select
        id::text as "id",
        name,
        slug,
        timezone,
        currency,
        country_code as "countryCode",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.campuses
      where active
      order by name
    `.execute(this.database.db);

    return result.rows;
  }

  async listAdminCampuses(campusId?: string): Promise<CampusRecord[]> {
    const result = await sql<CampusRecord>`
      select
        id::text as "id",
        name,
        slug,
        timezone,
        currency,
        country_code as "countryCode",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.campuses
      where ${campusId ?? null}::uuid is null or id = ${campusId ?? null}::uuid
      order by name
    `.execute(this.database.db);

    return result.rows;
  }

  async createCampus(input: CreateCampusInput): Promise<CampusRecord> {
    const result = await sql<CampusRecord>`
      insert into public.campuses (name, slug, timezone, currency, country_code, active)
      values (
        ${input.name},
        ${input.slug},
        ${input.timezone},
        ${input.currency},
        ${input.countryCode},
        ${input.active}
      )
      returning
        id::text as "id",
        name,
        slug,
        timezone,
        currency,
        country_code as "countryCode",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const campus = result.rows[0];
    if (campus === undefined) {
      throw new Error('Campus creation did not return a campus row.');
    }
    return campus;
  }

  async updateCampus(campusId: string, input: UpdateCampusInput): Promise<CampusRecord | undefined> {
    const hasName = Object.hasOwn(input, 'name');
    const hasSlug = Object.hasOwn(input, 'slug');
    const hasTimezone = Object.hasOwn(input, 'timezone');
    const hasCurrency = Object.hasOwn(input, 'currency');
    const hasCountryCode = Object.hasOwn(input, 'countryCode');
    const hasActive = Object.hasOwn(input, 'active');

    const result = await sql<CampusRecord>`
      update public.campuses
      set name = case when ${hasName} then ${input.name ?? null} else name end,
          slug = case when ${hasSlug} then ${input.slug ?? null} else slug end,
          timezone = case when ${hasTimezone} then ${input.timezone ?? null} else timezone end,
          currency = case when ${hasCurrency} then ${input.currency ?? null} else currency end,
          country_code = case when ${hasCountryCode} then ${input.countryCode ?? null} else country_code end,
          active = case when ${hasActive} then ${input.active ?? null} else active end,
          updated_at = now()
      where id = ${campusId}::uuid
      returning
        id::text as "id",
        name,
        slug,
        timezone,
        currency,
        country_code as "countryCode",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listAdminZones(campusId: string): Promise<CampusZoneRecord[]> {
    const result = await sql<CampusZoneRecord>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        name,
        code,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.campus_zones
      where campus_id = ${campusId}::uuid
      order by display_order, name
    `.execute(this.database.db);

    return result.rows;
  }

  async createZone(campusId: string, input: CreateZoneInput): Promise<CampusZoneRecord | undefined> {
    const result = await sql<CampusZoneRecord>`
      insert into public.campus_zones (campus_id, name, code, active, display_order)
      values (
        ${campusId}::uuid,
        ${input.name},
        ${input.code},
        ${input.active},
        ${input.displayOrder}
      )
      returning
        id::text as "id",
        campus_id::text as "campusId",
        name,
        code,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async updateZone(
    zoneId: string,
    input: UpdateZoneInput,
    scopedCampusId?: string
  ): Promise<CampusZoneRecord | undefined> {
    const hasName = Object.hasOwn(input, 'name');
    const hasCode = Object.hasOwn(input, 'code');
    const hasActive = Object.hasOwn(input, 'active');
    const hasDisplayOrder = Object.hasOwn(input, 'displayOrder');

    const result = await sql<CampusZoneRecord>`
      update public.campus_zones
      set name = case when ${hasName} then ${input.name ?? null} else name end,
          code = case when ${hasCode} then ${input.code ?? null} else code end,
          active = case when ${hasActive} then ${input.active ?? null} else active end,
          display_order = case when ${hasDisplayOrder} then ${input.displayOrder ?? null} else display_order end,
          updated_at = now()
      where id = ${zoneId}::uuid
        and (${scopedCampusId ?? null}::uuid is null or campus_id = ${scopedCampusId ?? null}::uuid)
      returning
        id::text as "id",
        campus_id::text as "campusId",
        name,
        code,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listPublicLocations(campusId: string): Promise<CampusLocationRecord[]> {
    const result = await sql<CampusLocationRecord>`
      select
        cl.id::text as "id",
        cl.campus_id::text as "campusId",
        cl.zone_id::text as "zoneId",
        cz.name as "zoneName",
        cz.code as "zoneCode",
        cl.name,
        cl.slug,
        cl.type::text as "type",
        cl.delivery_instructions as "deliveryInstructions",
        cl.active,
        cl.display_order as "displayOrder",
        cl.created_at::text as "createdAt",
        cl.updated_at::text as "updatedAt"
      from public.campus_locations cl
      join public.campus_zones cz on cz.id = cl.zone_id
      join public.campuses c on c.id = cl.campus_id
      where cl.campus_id = ${campusId}::uuid
        and cl.active
        and cz.active
        and c.active
      order by cz.display_order, cl.display_order, cl.name
    `.execute(this.database.db);

    return result.rows;
  }

  async listAdminLocations(campusId: string): Promise<CampusLocationRecord[]> {
    const result = await sql<CampusLocationRecord>`
      select
        cl.id::text as "id",
        cl.campus_id::text as "campusId",
        cl.zone_id::text as "zoneId",
        cz.name as "zoneName",
        cz.code as "zoneCode",
        cl.name,
        cl.slug,
        cl.type::text as "type",
        cl.delivery_instructions as "deliveryInstructions",
        cl.active,
        cl.display_order as "displayOrder",
        cl.created_at::text as "createdAt",
        cl.updated_at::text as "updatedAt"
      from public.campus_locations cl
      join public.campus_zones cz on cz.id = cl.zone_id
      where cl.campus_id = ${campusId}::uuid
      order by cz.display_order, cl.display_order, cl.name
    `.execute(this.database.db);

    return result.rows;
  }

  async createLocation(
    campusId: string,
    input: CreateLocationInput
  ): Promise<CampusLocationRecord | undefined> {
    const result = await sql<CampusLocationRecord>`
      insert into public.campus_locations (
        campus_id,
        zone_id,
        name,
        slug,
        type,
        delivery_instructions,
        active,
        display_order
      )
      select
        ${campusId}::uuid,
        ${input.zoneId}::uuid,
        ${input.name},
        ${input.slug},
        ${input.type}::public.location_type,
        ${input.deliveryInstructions},
        ${input.active},
        ${input.displayOrder}
      where exists (
        select 1 from public.campus_zones
        where id = ${input.zoneId}::uuid and campus_id = ${campusId}::uuid
      )
      returning
        id::text as "id",
        campus_id::text as "campusId",
        zone_id::text as "zoneId",
        (select name from public.campus_zones where id = zone_id) as "zoneName",
        (select code from public.campus_zones where id = zone_id) as "zoneCode",
        name,
        slug,
        type::text as "type",
        delivery_instructions as "deliveryInstructions",
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async updateLocation(
    locationId: string,
    input: UpdateLocationInput,
    scopedCampusId?: string
  ): Promise<CampusLocationRecord | undefined> {
    const hasZoneId = Object.hasOwn(input, 'zoneId');
    const hasName = Object.hasOwn(input, 'name');
    const hasSlug = Object.hasOwn(input, 'slug');
    const hasType = Object.hasOwn(input, 'type');
    const hasDeliveryInstructions = Object.hasOwn(input, 'deliveryInstructions');
    const hasActive = Object.hasOwn(input, 'active');
    const hasDisplayOrder = Object.hasOwn(input, 'displayOrder');

    const result = await sql<CampusLocationRecord>`
      update public.campus_locations
      set zone_id = case when ${hasZoneId} then ${input.zoneId ?? null}::uuid else zone_id end,
          name = case when ${hasName} then ${input.name ?? null} else name end,
          slug = case when ${hasSlug} then ${input.slug ?? null} else slug end,
          type = case when ${hasType} then ${input.type ?? null}::public.location_type else type end,
          delivery_instructions = case
            when ${hasDeliveryInstructions} then ${input.deliveryInstructions ?? null}
            else delivery_instructions
          end,
          active = case when ${hasActive} then ${input.active ?? null} else active end,
          display_order = case when ${hasDisplayOrder} then ${input.displayOrder ?? null} else display_order end,
          updated_at = now()
      where id = ${locationId}::uuid
        and (${scopedCampusId ?? null}::uuid is null or campus_id = ${scopedCampusId ?? null}::uuid)
        and (
          ${input.zoneId ?? null}::uuid is null
          or exists (
            select 1 from public.campus_zones cz
            where cz.id = ${input.zoneId ?? null}::uuid and cz.campus_id = campus_locations.campus_id
          )
        )
      returning
        id::text as "id",
        campus_id::text as "campusId",
        zone_id::text as "zoneId",
        (select name from public.campus_zones where id = zone_id) as "zoneName",
        (select code from public.campus_zones where id = zone_id) as "zoneCode",
        name,
        slug,
        type::text as "type",
        delivery_instructions as "deliveryInstructions",
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listPublicDeliverySlots(
    campusId: string,
    serviceDate?: string
  ): Promise<DeliverySlotRecord[]> {
    const result = await sql<DeliverySlotRecord>`
      select
        ds.id::text as "id",
        ds.campus_id::text as "campusId",
        ds.name,
        ds.delivery_time::text as "deliveryTime",
        ds.cutoff_minutes as "cutoffMinutes",
        ds.active,
        ds.display_order as "displayOrder",
        case
          when ${serviceDate ?? null}::date is null then null
          else public.effective_ordering_cutoff_at(${serviceDate ?? null}::date, ds.id)::text
        end as "orderingCutoffAt",
        case
          when ${serviceDate ?? null}::date is null then null
          else public.effective_ordering_cutoff_at(${serviceDate ?? null}::date, ds.id) > now()
        end as "acceptingOrders",
        ds.created_at::text as "createdAt",
        ds.updated_at::text as "updatedAt"
      from public.delivery_slots ds
      join public.campuses c on c.id = ds.campus_id
      where ds.campus_id = ${campusId}::uuid
        and ds.active
        and c.active
      order by ds.display_order, ds.delivery_time
    `.execute(this.database.db);

    return result.rows;
  }

  async listAdminDeliverySlots(campusId: string): Promise<DeliverySlotRecord[]> {
    const result = await sql<DeliverySlotRecord>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        name,
        delivery_time::text as "deliveryTime",
        cutoff_minutes as "cutoffMinutes",
        active,
        display_order as "displayOrder",
        null::text as "orderingCutoffAt",
        null::boolean as "acceptingOrders",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.delivery_slots
      where campus_id = ${campusId}::uuid
      order by display_order, delivery_time
    `.execute(this.database.db);

    return result.rows;
  }

  async createDeliverySlot(
    campusId: string,
    input: CreateDeliverySlotInput
  ): Promise<DeliverySlotRecord | undefined> {
    const result = await sql<DeliverySlotRecord>`
      insert into public.delivery_slots (
        campus_id,
        name,
        delivery_time,
        cutoff_minutes,
        active,
        display_order
      )
      values (
        ${campusId}::uuid,
        ${input.name},
        ${input.deliveryTime}::time,
        ${input.cutoffMinutes},
        ${input.active},
        ${input.displayOrder}
      )
      returning
        id::text as "id",
        campus_id::text as "campusId",
        name,
        delivery_time::text as "deliveryTime",
        cutoff_minutes as "cutoffMinutes",
        active,
        display_order as "displayOrder",
        null::text as "orderingCutoffAt",
        null::boolean as "acceptingOrders",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async updateDeliverySlot(
    slotId: string,
    input: UpdateDeliverySlotInput,
    scopedCampusId?: string
  ): Promise<DeliverySlotRecord | undefined> {
    const hasName = Object.hasOwn(input, 'name');
    const hasDeliveryTime = Object.hasOwn(input, 'deliveryTime');
    const hasCutoffMinutes = Object.hasOwn(input, 'cutoffMinutes');
    const hasActive = Object.hasOwn(input, 'active');
    const hasDisplayOrder = Object.hasOwn(input, 'displayOrder');

    const result = await sql<DeliverySlotRecord>`
      update public.delivery_slots
      set name = case when ${hasName} then ${input.name ?? null} else name end,
          delivery_time = case when ${hasDeliveryTime} then ${input.deliveryTime ?? null}::time else delivery_time end,
          cutoff_minutes = case when ${hasCutoffMinutes} then ${input.cutoffMinutes ?? null} else cutoff_minutes end,
          active = case when ${hasActive} then ${input.active ?? null} else active end,
          display_order = case when ${hasDisplayOrder} then ${input.displayOrder ?? null} else display_order end,
          updated_at = now()
      where id = ${slotId}::uuid
        and (${scopedCampusId ?? null}::uuid is null or campus_id = ${scopedCampusId ?? null}::uuid)
      returning
        id::text as "id",
        campus_id::text as "campusId",
        name,
        delivery_time::text as "deliveryTime",
        cutoff_minutes as "cutoffMinutes",
        active,
        display_order as "displayOrder",
        null::text as "orderingCutoffAt",
        null::boolean as "acceptingOrders",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }
}
