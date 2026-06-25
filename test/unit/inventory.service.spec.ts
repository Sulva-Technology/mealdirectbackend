import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import type {
  InventoryAdjustmentRecord,
  InventoryRecord,
  InventoryRepositoryContract
} from '../../src/modules/inventory/inventory.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const inventoryId = '33333333-3333-4333-8333-333333333333';
const slotId = '44444444-4444-4444-8444-444444444444';

const actor: AuthenticatedActor = {
  role: 'vendor',
  userId,
  vendorId
};

const inventory: InventoryRecord = {
  id: inventoryId,
  vendorId,
  menuItemId: '55555555-5555-4555-8555-555555555555',
  menuItemName: 'Jollof Rice',
  categoryId: null,
  categoryName: null,
  unitTypeId: '66666666-6666-4666-8666-666666666666',
  unitCode: 'plate',
  serviceDate: '2026-06-16',
  deliverySlotId: slotId,
  deliverySlotName: 'Lunch',
  quantityTotal: 10,
  quantityReserved: 2,
  quantitySold: 1,
  quantityAdjusted: 0,
  remainingQuantity: 7,
  active: true,
  version: 3,
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z',
  adjustments: []
};

const adjustment: InventoryAdjustmentRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  inventoryId,
  adjustmentQuantity: 5,
  reason: 'Extra portions cooked',
  actorUserId: userId,
  metadata: { source: 'vendor_app' },
  createdAt: '2026-06-15T08:10:00.000Z'
};

function createRepository(): InventoryRepositoryContract {
  return {
    assertVendorAccess: vi.fn().mockResolvedValue(true),
    ensureInventoryForDate: vi.fn().mockResolvedValue(undefined),
    listInventory: vi.fn().mockResolvedValue([inventory]),
    findInventoryForVendor: vi.fn().mockResolvedValue(inventory),
    updateInventoryTotal: vi.fn().mockResolvedValue({ ...inventory, quantityTotal: 12 }),
    recordAdjustment: vi.fn().mockResolvedValue({
      adjustment,
      inventory: {
        ...inventory,
        quantityAdjusted: 5,
        remainingQuantity: 12,
        adjustments: [adjustment]
      }
    })
  };
}

describe('InventoryService', () => {
  let repository: InventoryRepositoryContract;
  let service: InventoryService;

  beforeEach(() => {
    repository = createRepository();
    service = new InventoryService(repository);
  });

  it('requires vendor object access before listing inventory', async () => {
    vi.mocked(repository.assertVendorAccess).mockResolvedValue(false);

    await expect(
      service.listInventory(actor, {
        date: '2026-06-16'
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.listInventory).not.toHaveBeenCalled();
  });

  it('generates inventory for the requested date before listing', async () => {
    await service.listInventory(actor, { date: '2026-06-16' });

    expect(repository.ensureInventoryForDate).toHaveBeenCalledWith(vendorId, '2026-06-16');
    expect(repository.listInventory).toHaveBeenCalledWith(vendorId, { date: '2026-06-16' });
  });

  it('rejects total quantity updates below reserved and sold units', async () => {
    await expect(
      service.updateInventory(actor, inventoryId, {
        quantityTotal: 2
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateInventoryTotal).not.toHaveBeenCalled();
  });

  it('rejects stale inventory updates with a conflict', async () => {
    await expect(
      service.updateInventory(actor, inventoryId, {
        expectedVersion: 2,
        quantityTotal: 12
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateInventoryTotal).not.toHaveBeenCalled();
  });

  it('maps missing inventory rows to not found', async () => {
    vi.mocked(repository.findInventoryForVendor).mockResolvedValue(undefined);

    await expect(
      service.updateInventory(actor, inventoryId, {
        quantityTotal: 12
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects adjustments that would make effective inventory lower than reservations', async () => {
    await expect(
      service.createAdjustment(actor, inventoryId, {
        adjustmentQuantity: -8,
        reason: 'Spoiled portions'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.recordAdjustment).not.toHaveBeenCalled();
  });

  it('records valid adjustments with trimmed reason and actor context', async () => {
    await service.createAdjustment(actor, inventoryId, {
      adjustmentQuantity: 5,
      metadata: { source: 'vendor_app' },
      reason: ' Extra portions cooked '
    });

    expect(repository.recordAdjustment).toHaveBeenCalledWith(
      vendorId,
      inventoryId,
      {
        adjustmentQuantity: 5,
        metadata: { source: 'vendor_app' },
        reason: 'Extra portions cooked'
      },
      userId
    );
  });
});
