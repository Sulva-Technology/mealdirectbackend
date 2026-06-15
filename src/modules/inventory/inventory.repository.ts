import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CreateInventoryAdjustmentInput,
  InventoryAdjustmentRecord,
  InventoryAdjustmentResponse,
  InventoryListFilters,
  InventoryRecord,
  InventoryRepositoryContract,
  UpdateInventoryInput
} from './inventory.types.js';

type AccessResult = {
  hasAccess: boolean;
};

type IdResult = {
  id: string;
};

type InventoryRow = Omit<InventoryRecord, 'adjustments'> & {
  adjustments: unknown;
};

function toAdjustments(value: unknown): InventoryAdjustmentRecord[] {
  if (Array.isArray(value)) {
    return value as InventoryAdjustmentRecord[];
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as InventoryAdjustmentRecord[];
  }
  return [];
}

function toInventoryRecord(row: InventoryRow): InventoryRecord {
  return {
    ...row,
    adjustments: toAdjustments(row.adjustments)
  };
}

@Injectable()
export class InventoryRepository implements InventoryRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<AccessResult>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async listInventory(vendorId: string, filters: InventoryListFilters): Promise<InventoryRecord[]> {
    const result = await sql<InventoryRow>`
      select
        inv.id::text as "id",
        mi.vendor_id::text as "vendorId",
        mi.id::text as "menuItemId",
        mi.name as "menuItemName",
        mi.category_id::text as "categoryId",
        mc.name as "categoryName",
        ut.id::text as "unitTypeId",
        ut.code as "unitCode",
        inv.service_date::text as "serviceDate",
        inv.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        inv.quantity_total as "quantityTotal",
        inv.quantity_reserved as "quantityReserved",
        inv.quantity_sold as "quantitySold",
        inv.quantity_adjusted as "quantityAdjusted",
        (
          inv.quantity_total
          + inv.quantity_adjusted
          - inv.quantity_reserved
          - inv.quantity_sold
        ) as "remainingQuantity",
        inv.active,
        inv.version,
        inv.created_at::text as "createdAt",
        inv.updated_at::text as "updatedAt",
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', ia.id::text,
              'inventoryId', ia.inventory_id::text,
              'adjustmentQuantity', ia.adjustment_quantity,
              'reason', ia.reason,
              'actorUserId', ia.actor_user_id::text,
              'metadata', ia.metadata,
              'createdAt', ia.created_at::text
            )
            order by ia.created_at desc
          ) filter (where ia.id is not null),
          '[]'::jsonb
        ) as "adjustments"
      from public.menu_item_inventory inv
      join public.menu_items mi on mi.id = inv.menu_item_id
      join public.unit_types ut on ut.id = mi.unit_type_id
      join public.delivery_slots ds on ds.id = inv.delivery_slot_id
      left join public.menu_categories mc on mc.id = mi.category_id
      left join public.inventory_adjustments ia on ia.inventory_id = inv.id
      where mi.vendor_id = ${vendorId}::uuid
        and inv.service_date = ${filters.date}::date
        and (
          ${filters.slotId ?? null}::uuid is null
          or inv.delivery_slot_id = ${filters.slotId ?? null}::uuid
        )
      group by inv.id, mi.id, mc.id, ut.id, ds.id
      order by ds.display_order, mc.display_order nulls last, mi.display_order, mi.name
    `.execute(this.database.db);

    return result.rows.map((row) => toInventoryRecord(row));
  }

  async findInventoryForVendor(
    vendorId: string,
    inventoryId: string
  ): Promise<InventoryRecord | undefined> {
    const result = await sql<InventoryRow>`
      select
        inv.id::text as "id",
        mi.vendor_id::text as "vendorId",
        mi.id::text as "menuItemId",
        mi.name as "menuItemName",
        mi.category_id::text as "categoryId",
        mc.name as "categoryName",
        ut.id::text as "unitTypeId",
        ut.code as "unitCode",
        inv.service_date::text as "serviceDate",
        inv.delivery_slot_id::text as "deliverySlotId",
        ds.name as "deliverySlotName",
        inv.quantity_total as "quantityTotal",
        inv.quantity_reserved as "quantityReserved",
        inv.quantity_sold as "quantitySold",
        inv.quantity_adjusted as "quantityAdjusted",
        (
          inv.quantity_total
          + inv.quantity_adjusted
          - inv.quantity_reserved
          - inv.quantity_sold
        ) as "remainingQuantity",
        inv.active,
        inv.version,
        inv.created_at::text as "createdAt",
        inv.updated_at::text as "updatedAt",
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', ia.id::text,
              'inventoryId', ia.inventory_id::text,
              'adjustmentQuantity', ia.adjustment_quantity,
              'reason', ia.reason,
              'actorUserId', ia.actor_user_id::text,
              'metadata', ia.metadata,
              'createdAt', ia.created_at::text
            )
            order by ia.created_at desc
          ) filter (where ia.id is not null),
          '[]'::jsonb
        ) as "adjustments"
      from public.menu_item_inventory inv
      join public.menu_items mi on mi.id = inv.menu_item_id
      join public.unit_types ut on ut.id = mi.unit_type_id
      join public.delivery_slots ds on ds.id = inv.delivery_slot_id
      left join public.menu_categories mc on mc.id = mi.category_id
      left join public.inventory_adjustments ia on ia.inventory_id = inv.id
      where mi.vendor_id = ${vendorId}::uuid
        and inv.id = ${inventoryId}::uuid
      group by inv.id, mi.id, mc.id, ut.id, ds.id
    `.execute(this.database.db);

    const row = result.rows[0];
    return row === undefined ? undefined : toInventoryRecord(row);
  }

  async updateInventoryTotal(
    vendorId: string,
    inventoryId: string,
    input: UpdateInventoryInput
  ): Promise<InventoryRecord | undefined> {
    const result = await sql<IdResult>`
      update public.menu_item_inventory inv
      set quantity_total = ${input.quantityTotal},
          version = version + 1,
          updated_at = now()
      from public.menu_items mi
      where inv.menu_item_id = mi.id
        and mi.vendor_id = ${vendorId}::uuid
        and inv.id = ${inventoryId}::uuid
      returning inv.id::text as "id"
    `.execute(this.database.db);

    const id = result.rows[0]?.id;
    return id === undefined ? undefined : this.findInventoryForVendor(vendorId, id);
  }

  async recordAdjustment(
    vendorId: string,
    inventoryId: string,
    input: CreateInventoryAdjustmentInput,
    actorUserId: string
  ): Promise<InventoryAdjustmentResponse> {
    const adjustmentResult = await sql<IdResult>`
      select public.record_inventory_adjustment(
        ${inventoryId}::uuid,
        ${input.adjustmentQuantity},
        ${input.reason},
        ${actorUserId}::uuid,
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )::text as "id"
      where exists (
        select 1
        from public.menu_item_inventory inv
        join public.menu_items mi on mi.id = inv.menu_item_id
        where inv.id = ${inventoryId}::uuid
          and mi.vendor_id = ${vendorId}::uuid
      )
    `.execute(this.database.db);

    const adjustmentId = adjustmentResult.rows[0]?.id;
    if (adjustmentId === undefined) {
      throw new Error('Inventory row was not found for the current vendor.');
    }

    const [adjustment, inventory] = await Promise.all([
      this.findAdjustmentById(adjustmentId),
      this.findInventoryForVendor(vendorId, inventoryId)
    ]);

    if (adjustment === undefined || inventory === undefined) {
      throw new Error('Inventory adjustment was recorded but could not be reloaded.');
    }

    return { adjustment, inventory };
  }

  private async findAdjustmentById(
    adjustmentId: string
  ): Promise<InventoryAdjustmentRecord | undefined> {
    const result = await sql<InventoryAdjustmentRecord>`
      select
        id::text as "id",
        inventory_id::text as "inventoryId",
        adjustment_quantity as "adjustmentQuantity",
        reason,
        actor_user_id::text as "actorUserId",
        metadata,
        created_at::text as "createdAt"
      from public.inventory_adjustments
      where id = ${adjustmentId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }
}
