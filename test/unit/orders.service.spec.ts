import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { CreateOrderDto } from '../../src/modules/orders/dto/create-order.dto.js';
import { OrdersService } from '../../src/modules/orders/orders.service.js';
import type {
  OrderDetail,
  OrderQuoteItem,
  OrdersRepositoryContract
} from '../../src/modules/orders/orders.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const rider: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'rider'
};

const orderInput: CreateOrderDto = {
  campusId: '33333333-3333-4333-8333-333333333333',
  deliverySlotId: '44444444-4444-4444-8444-444444444444',
  items: [{ menuItemId: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
  locationId: '66666666-6666-4666-8666-666666666666',
  serviceDate: '2026-06-15',
  vendorId: '77777777-7777-4777-8777-777777777777'
};

const quoteItem: OrderQuoteItem = {
  menuItemId: orderInput.items[0]?.menuItemId ?? '',
  name: 'Jollof Rice',
  quantity: 2,
  remainingQuantity: 10,
  unitPriceKobo: 250000,
  lineTotalKobo: 500000
};

const orderDetail: OrderDetail = {
  id: '88888888-8888-4888-8888-888888888888',
  orderNumber: 'MD-0001',
  customerId: customer.userId,
  campusId: orderInput.campusId,
  vendorId: orderInput.vendorId,
  vendorDisplayName: 'Ada Kitchen',
  serviceDate: orderInput.serviceDate,
  deliverySlotId: orderInput.deliverySlotId,
  deliverySlotName: 'Lunch',
  locationId: orderInput.locationId,
  locationName: 'Hall One',
  orderStatus: 'pending_payment',
  deliveryMode: 'meal_direct_rider',
  foodSubtotalKobo: 500000,
  deliveryFeeKobo: 15000,
  discountKobo: 0,
  totalKobo: 515000,
  currency: 'NGN',
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z',
  paidAt: null,
  deliveredAt: null,
  confirmedAt: null,
  items: [],
  latestPayment: null
};

function createRepository(): OrdersRepositoryContract {
  return {
    confirmDelivery: vi
      .fn()
      .mockResolvedValue({ confirmationId: '99999999-9999-4999-8999-999999999999' }),
    createOrder: vi.fn().mockResolvedValue({ orderId: orderDetail.id }),
    findCustomerOrderById: vi.fn().mockResolvedValue(orderDetail),
    findPaymentStatus: vi.fn().mockResolvedValue({
      orderId: orderDetail.id,
      orderStatus: 'pending_payment',
      payment: null
    }),
    listCustomerOrders: vi.fn().mockResolvedValue([orderDetail]),
    quoteOrder: vi.fn().mockResolvedValue([quoteItem])
  };
}

describe('OrdersService', () => {
  let repository: OrdersRepositoryContract;
  let service: OrdersService;

  beforeEach(() => {
    repository = createRepository();
    service = new OrdersService(repository);
  });

  it('quotes order totals from available menu items', async () => {
    await expect(service.quoteOrder(customer, orderInput)).resolves.toEqual({
      currency: 'NGN',
      deliveryFeeKobo: 15000,
      discountKobo: 0,
      foodSubtotalKobo: 500000,
      items: [quoteItem],
      totalKobo: 515000
    });
  });

  it('rejects quote items that are unavailable for the requested slot', async () => {
    vi.mocked(repository.quoteOrder).mockResolvedValue([]);

    await expect(service.quoteOrder(customer, orderInput)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('keeps order creation customer-only', async () => {
    await expect(service.createOrder(rider, orderInput, 'order-key')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('reads only customer-owned orders through repository methods', async () => {
    await expect(service.listCustomerOrders(customer, {})).resolves.toEqual([orderDetail]);
    await expect(service.getCustomerOrder(customer, orderDetail.id)).resolves.toEqual(orderDetail);

    vi.mocked(repository.findCustomerOrderById).mockResolvedValue(undefined);
    await expect(service.getCustomerOrder(customer, orderDetail.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('confirms delivery through the database function wrapper', async () => {
    await expect(service.confirmDelivery(customer, orderDetail.id)).resolves.toEqual({
      confirmationId: '99999999-9999-4999-8999-999999999999'
    });
  });
});
