import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CatalogRepositoryContract,
  CatalogVendor,
  MenuFilters,
  MenuItem,
  VendorListFilters
} from './catalog.types.js';

function usesAvailability(filters: { date?: string; slotId?: string }): boolean {
  return filters.date !== undefined && filters.slotId !== undefined;
}

@Injectable()
export class CatalogRepository implements CatalogRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listVendors(filters: VendorListFilters): Promise<CatalogVendor[]> {
    if (usesAvailability(filters)) {
      const result = await sql<CatalogVendor>`
        select
          v.id::text as "id",
          v.campus_id::text as "campusId",
          v.display_name as "displayName",
          v.slug,
          v.description,
          v.logo_url as "logoUrl",
          v.kitchen_location as "kitchenLocation",
          av.default_delivery_mode::text as "defaultDeliveryMode"
        from public.available_vendors(
          ${filters.campusId}::uuid,
          ${filters.date ?? null}::date,
          ${filters.slotId ?? null}::uuid
        ) av
        join public.vendors v on v.id = av.vendor_id
        where ${filters.locationId ?? null}::uuid is null
          or exists (
            select 1
            from public.campus_locations cl
            where cl.id = ${filters.locationId ?? null}::uuid
              and cl.campus_id = v.campus_id
              and cl.active
          )
        order by v.display_name
      `.execute(this.database.db);

      return result.rows;
    }

    const result = await sql<CatalogVendor>`
      select
        v.id::text as "id",
        v.campus_id::text as "campusId",
        v.display_name as "displayName",
        v.slug,
        v.description,
        v.logo_url as "logoUrl",
        v.kitchen_location as "kitchenLocation",
        v.default_delivery_mode::text as "defaultDeliveryMode"
      from public.vendors v
      join public.campuses c on c.id = v.campus_id
      where v.campus_id = ${filters.campusId}::uuid
        and v.status = 'approved'
        and v.active
        and c.active
        and (
          ${filters.locationId ?? null}::uuid is null
          or exists (
            select 1
            from public.campus_locations cl
            where cl.id = ${filters.locationId ?? null}::uuid
              and cl.campus_id = v.campus_id
              and cl.active
          )
        )
      order by v.display_name
    `.execute(this.database.db);

    return result.rows;
  }

  async findVendorById(vendorId: string): Promise<CatalogVendor | undefined> {
    const result = await sql<CatalogVendor>`
      select
        v.id::text as "id",
        v.campus_id::text as "campusId",
        v.display_name as "displayName",
        v.slug,
        v.description,
        v.logo_url as "logoUrl",
        v.kitchen_location as "kitchenLocation",
        v.default_delivery_mode::text as "defaultDeliveryMode"
      from public.vendors v
      join public.campuses c on c.id = v.campus_id
      where v.id = ${vendorId}::uuid
        and v.status = 'approved'
        and v.active
        and c.active
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listMenuItems(vendorId: string, filters: MenuFilters): Promise<MenuItem[]> {
    if (usesAvailability(filters)) {
      const result = await sql<MenuItem>`
        with target_vendor as (
          select id, campus_id
          from public.vendors
          where id = ${vendorId}::uuid
            and status = 'approved'
            and active
        )
        select
          ami.menu_item_id::text as "id",
          ami.vendor_id::text as "vendorId",
          ami.category_id::text as "categoryId",
          mc.name as "categoryName",
          ami.unit_type_id::text as "unitTypeId",
          ami.unit_code as "unitCode",
          ami.name,
          ami.description,
          ami.image_url as "imageUrl",
          ami.price_kobo as "priceKobo",
          ami.remaining_quantity as "remainingQuantity",
          ut.counts_toward_spoon_limit as "countsTowardSpoonLimit"
        from target_vendor tv
        join public.available_menu_items(
          tv.campus_id,
          ${filters.date ?? null}::date,
          ${filters.slotId ?? null}::uuid
        ) ami on ami.vendor_id = tv.id
        join public.unit_types ut on ut.id = ami.unit_type_id
        left join public.menu_categories mc on mc.id = ami.category_id
        order by mc.display_order nulls last, ami.name
      `.execute(this.database.db);

      return result.rows;
    }

    const result = await sql<MenuItem>`
      select
        mi.id::text as "id",
        mi.vendor_id::text as "vendorId",
        mi.category_id::text as "categoryId",
        mc.name as "categoryName",
        ut.id::text as "unitTypeId",
        ut.code as "unitCode",
        mi.name,
        mi.description,
        mi.image_url as "imageUrl",
        mi.price_kobo as "priceKobo",
        null::integer as "remainingQuantity",
        ut.counts_toward_spoon_limit as "countsTowardSpoonLimit"
      from public.menu_items mi
      join public.vendors v on v.id = mi.vendor_id
      join public.campuses c on c.id = v.campus_id
      join public.unit_types ut on ut.id = mi.unit_type_id and ut.active
      left join public.menu_categories mc on mc.id = mi.category_id and mc.active
      where mi.vendor_id = ${vendorId}::uuid
        and mi.active
        and v.status = 'approved'
        and v.active
        and c.active
      order by mc.display_order nulls last, mi.display_order, mi.name
    `.execute(this.database.db);

    return result.rows;
  }
}
