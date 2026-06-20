import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { BatchesService } from '../../src/modules/batches/batches.service.js';
import { BatchesRepository } from '../../src/modules/batches/batches.repository.js';
import type { BatchSummary } from '../../src/modules/batches/batches.types.js';
import type { OrderSummary } from '../../src/modules/orders/orders.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';

const actor: AuthenticatedActor = {
  userId,
  role: 'vendor',
  vendorId
};

const batchSummary: BatchSummary = {
  id: batchId,
  campusId: '55555555-5555-4555-8555-555555555555',
  vendorId,
  serviceDate: '2026-06-15',
  deliverySlotId: '66666666-6666-4666-8666-666666666666',
  zoneId: '77777777-7777-4777-8777-777777777777',
  batchNumber: 'MDB-20260615-12345678',
  status: 'closed',
  deliveryMode: 'meal_direct_rider',
  orderCount: 1,
  deliveryEarningsKobo: 7500,
  cutoffAt: '2026-06-15T12:00:00.000Z',
  closedAt: '2026-06-15T12:00:00.000Z',
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T12:00:00.000Z'
};

const orderSummary: OrderSummary = {
  id: '88888888-8888-4888-8888-888888888888',
  orderNumber: 'MD-20260615-123456',
  customerId: '99999999-9999-4999-8999-999999999999',
  campusId: '55555555-5555-4555-8555-555555555555',
  vendorId,
  vendorDisplayName: 'Ada Kitchen',
  serviceDate: '2026-06-15',
  deliverySlotId: '66666666-6666-4666-8666-666666666666',
  deliverySlotName: 'Lunch Slot',
  locationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  locationName: 'Main gate',
  orderStatus: 'ready',
  deliveryMode: 'meal_direct_rider',
  specialInstructions: null,
  foodSubtotalKobo: 250000,
  deliveryFeeKobo: 15000,
  discountKobo: 0,
  totalKobo: 265000,
  currency: 'NGN',
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z',
  paidAt: '2026-06-15T08:05:00.000Z',
  deliveredAt: null,
  confirmedAt: null
};

type MockBatchesRepository = {
  assertVendorAccess: ReturnType<typeof vi.fn>;
  listVendorBatches: ReturnType<typeof vi.fn>;
  findVendorBatchById: ReturnType<typeof vi.fn>;
  findBatchOrders: ReturnType<typeof vi.fn>;
  pickupBatch: ReturnType<typeof vi.fn>;
};

function createMockRepository(): MockBatchesRepository {
  return {
    assertVendorAccess: vi.fn().mockResolvedValue(true),
    listVendorBatches: vi.fn().mockResolvedValue([batchSummary]),
    findVendorBatchById: vi.fn().mockResolvedValue(batchSummary),
    findBatchOrders: vi.fn().mockResolvedValue([orderSummary]),
    pickupBatch: vi.fn().mockResolvedValue(undefined)
  };
}

describe('BatchesService', () => {
  let repository: MockBatchesRepository;
  let service: BatchesService;

  beforeEach(() => {
    repository = createMockRepository();
    service = new BatchesService(repository as unknown as BatchesRepository);
  });

  it('requires vendor access check when listing batches', async () => {
    vi.mocked(repository.assertVendorAccess).mockResolvedValue(false);

    await expect(service.listBatches(actor, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.listVendorBatches).not.toHaveBeenCalled();
  });

  it('lists batches associated with the authenticated vendor', async () => {
    const result = await service.listBatches(actor, { status: 'closed', date: '2026-06-15' });

    expect(repository.assertVendorAccess).toHaveBeenCalledWith(vendorId, userId);
    expect(repository.listVendorBatches).toHaveBeenCalledWith(vendorId, {
      status: 'closed',
      date: '2026-06-15'
    });
    expect(result).toEqual([batchSummary]);
  });

  it('retrieves detailed summary of a single vendor batch including orders', async () => {
    const result = await service.getBatch(actor, batchId);

    expect(repository.assertVendorAccess).toHaveBeenCalledWith(vendorId, userId);
    expect(repository.findVendorBatchById).toHaveBeenCalledWith(vendorId, batchId);
    expect(repository.findBatchOrders).toHaveBeenCalledWith(batchId);
    expect(result).toEqual({
      ...batchSummary,
      orders: [orderSummary]
    });
  });

  it('maps missing vendor batch to NotFoundException', async () => {
    vi.mocked(repository.findVendorBatchById).mockResolvedValue(undefined);

    await expect(service.getBatch(actor, batchId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('transitions batch using ready-for-pickup (pickupBatch) action', async () => {
    const result = await service.pickupBatch(actor, batchId);

    expect(repository.pickupBatch).toHaveBeenCalledWith(batchId, userId);
    expect(result).toEqual({
      ...batchSummary,
      orders: [orderSummary]
    });
  });
});
