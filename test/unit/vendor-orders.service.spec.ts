import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { VendorOrdersService } from '../../src/modules/vendors/vendor-orders.service.js';
import { VendorOrdersRepository } from '../../src/modules/vendors/vendor-orders.repository.js';
import type { OrderDetail, OrderSummary } from '../../src/modules/orders/orders.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';

const actor: AuthenticatedActor = {
  userId,
  role: 'vendor',
  vendorId
};

const orderSummary: OrderSummary = {
  id: orderId,
  orderNumber: 'MD-20260615-123456',
  customerId: '55555555-5555-4555-8555-555555555555',
  campusId: '66666666-6666-4666-8666-666666666666',
  vendorId,
  vendorDisplayName: 'Ada Kitchen',
  serviceDate: '2026-06-15',
  deliverySlotId: '77777777-7777-4777-8777-777777777777',
  deliverySlotName: 'Lunch Slot',
  locationId: '88888888-8888-4888-8888-888888888888',
  locationName: 'Main gate',
  orderStatus: 'paid',
  deliveryMode: 'meal_direct_rider',
  specialInstructions: null,
  roomNumber: null,
  foodSubtotalKobo: 250000,
  deliveryFeeKobo: 15000,
  serviceFeeKobo: 0,
  discountKobo: 0,
  largeOrderSurchargeKobo: 0,
  totalKobo: 265000,
  currency: 'NGN',
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z',
  paidAt: '2026-06-15T08:05:00.000Z',
  deliveredAt: null,
  confirmedAt: null
};

const orderDetail: OrderDetail = {
  ...orderSummary,
  items: [],
  latestPayment: null
};

type MockVendorOrdersRepository = {
  assertVendorAccess: ReturnType<typeof vi.fn>;
  listVendorOrders: ReturnType<typeof vi.fn>;
  findVendorOrderById: ReturnType<typeof vi.fn>;
  transitionOrderStatus: ReturnType<typeof vi.fn>;
};

function createMockRepository(): MockVendorOrdersRepository {
  return {
    assertVendorAccess: vi.fn().mockResolvedValue(true),
    listVendorOrders: vi.fn().mockResolvedValue([orderSummary]),
    findVendorOrderById: vi.fn().mockResolvedValue(orderDetail),
    transitionOrderStatus: vi.fn().mockResolvedValue('accepted')
  };
}

describe('VendorOrdersService', () => {
  let repository: MockVendorOrdersRepository;
  let service: VendorOrdersService;

  beforeEach(() => {
    repository = createMockRepository();
    service = new VendorOrdersService(repository as unknown as VendorOrdersRepository);
  });

  it('requires vendor access check when listing orders', async () => {
    vi.mocked(repository.assertVendorAccess).mockResolvedValue(false);

    await expect(service.listOrders(actor, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.listVendorOrders).not.toHaveBeenCalled();
  });

  it('lists orders placed with the authenticated vendor', async () => {
    const result = await service.listOrders(actor, { status: 'paid', date: '2026-06-15' });

    expect(repository.assertVendorAccess).toHaveBeenCalledWith(vendorId, userId);
    expect(repository.listVendorOrders).toHaveBeenCalledWith(
      vendorId,
      { status: 'paid', date: '2026-06-15' },
      { page: 1, limit: 20 }
    );
    expect(result).toEqual([orderSummary]);
  });

  it('retrieves detailed summary of a single vendor order', async () => {
    const result = await service.getOrder(actor, orderId);

    expect(repository.assertVendorAccess).toHaveBeenCalledWith(vendorId, userId);
    expect(repository.findVendorOrderById).toHaveBeenCalledWith(vendorId, orderId);
    expect(result).toEqual(orderDetail);
  });

  it('maps missing vendor order to NotFoundException', async () => {
    vi.mocked(repository.findVendorOrderById).mockResolvedValue(undefined);

    await expect(service.getOrder(actor, orderId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('transitions order to accepted status', async () => {
    const result = await service.acceptOrder(actor, orderId);

    expect(repository.transitionOrderStatus).toHaveBeenCalledWith(orderId, 'accepted', userId);
    expect(result).toEqual(orderDetail);
  });

  it('transitions order to preparing status', async () => {
    const result = await service.prepareOrder(actor, orderId);

    expect(repository.transitionOrderStatus).toHaveBeenCalledWith(orderId, 'preparing', userId);
    expect(result).toEqual(orderDetail);
  });

  it('transitions order to ready status', async () => {
    const result = await service.readyOrder(actor, orderId);

    expect(repository.transitionOrderStatus).toHaveBeenCalledWith(orderId, 'ready', userId);
    expect(result).toEqual(orderDetail);
  });
});
