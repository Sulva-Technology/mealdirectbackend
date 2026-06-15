export type InventoryAdjustmentRecord = {
  id: string;
  inventoryId: string;
  adjustmentQuantity: number;
  reason: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type InventoryRecord = {
  id: string;
  vendorId: string;
  menuItemId: string;
  menuItemName: string;
  categoryId: string | null;
  categoryName: string | null;
  unitTypeId: string;
  unitCode: string;
  serviceDate: string;
  deliverySlotId: string;
  deliverySlotName: string;
  quantityTotal: number;
  quantityReserved: number;
  quantitySold: number;
  quantityAdjusted: number;
  remainingQuantity: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  adjustments: InventoryAdjustmentRecord[];
};

export type InventoryListFilters = {
  date: string;
  slotId?: string;
};

export type UpdateInventoryInput = {
  quantityTotal: number;
  expectedVersion?: number;
};

export type CreateInventoryAdjustmentInput = {
  adjustmentQuantity: number;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type InventoryAdjustmentResponse = {
  adjustment: InventoryAdjustmentRecord;
  inventory: InventoryRecord;
};

export type InventoryRepositoryContract = {
  assertVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  listInventory: (vendorId: string, filters: InventoryListFilters) => Promise<InventoryRecord[]>;
  findInventoryForVendor: (
    vendorId: string,
    inventoryId: string
  ) => Promise<InventoryRecord | undefined>;
  updateInventoryTotal: (
    vendorId: string,
    inventoryId: string,
    input: UpdateInventoryInput
  ) => Promise<InventoryRecord | undefined>;
  recordAdjustment: (
    vendorId: string,
    inventoryId: string,
    input: CreateInventoryAdjustmentInput,
    actorUserId: string
  ) => Promise<InventoryAdjustmentResponse>;
};
