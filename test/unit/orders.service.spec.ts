import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { CreateOrderDto } from '../../src/modules/orders/dto/create-order.dto.js';
import type { EnvService } from '../../src/config/env.service.js';
import { OrdersService } from '../../src/modules/orders/orders.service.js';
import type { PaymentsService } from '../../src/modules/payments/payments.service.js';
import type {
  OrderDetail,
  OrderQuoteItem,
  OrdersRepositoryContract
} from '../../src/modules/orders/orders.types.js';

function createEnv(
  overrides: {
    DELIVERY_FEE_KOBO?: number;
    SERVICE_FEE_KOBO?: number;
    MAX_ORDER_TOTAL_KOBO?: number;
    LARGE_ORDER_SURCHARGE_BPS?: number;
    LARGE_ORDER_SURCHARGE_FLAT_KOBO?: number;
  } = {}
): EnvService {
  const values: Record<string, number> = {
    DELIVERY_FEE_KOBO: overrides.DELIVERY_FEE_KOBO ?? 15000,
    SERVICE_FEE_KOBO: overrides.SERVICE_FEE_KOBO ?? 0,
    MAX_ORDER_TOTAL_KOBO: overrides.MAX_ORDER_TOTAL_KOBO ?? 100_000_000,
    LARGE_ORDER_SURCHARGE_BPS: overrides.LARGE_ORDER_SURCHARGE_BPS ?? 150,
    LARGE_ORDER_SURCHARGE_FLAT_KOBO: overrides.LARGE_ORDER_SURCHARGE_FLAT_KOBO ?? 10000
  };
  return { get: (key: string) => values[key] } as unknown as EnvService;
}

const defaultSurchargeConfig = { surchargeBps: 150, surchargeFlatKobo: 10000, accepted: false };

function createPayments(): PaymentsService {
  return {
    verifyPendingOrderPayment: vi.fn().mockResolvedValue(undefined)
  } as unknown as PaymentsService;
}

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
  lineTotalKobo: 500000,
  countsTowardSpoonLimit: true,
  triggersTakeawayFee: true
};

const nonTakeawayQuoteItem: OrderQuoteItem = {
  menuItemId: '99999999-9999-4999-8999-999999999991',
  name: 'Table Water',
  quantity: 2,
  remainingQuantity: 10,
  unitPriceKobo: 20000,
  lineTotalKobo: 40000,
  countsTowardSpoonLimit: false,
  triggersTakeawayFee: false
};

// Pepper soup: single-portion + takeaway. Pulls the takeaway fee but does NOT count toward
// the three-spoon cap — proves the two behaviours are now independent.
const singleTakeawayQuoteItem: OrderQuoteItem = {
  menuItemId: '99999999-9999-4999-8999-999999999992',
  name: 'Pepper Soup',
  quantity: 1,
  remainingQuantity: 10,
  unitPriceKobo: 300000,
  lineTotalKobo: 300000,
  countsTowardSpoonLimit: false,
  triggersTakeawayFee: true
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
  specialInstructions: null,
  roomNumber: null,
  foodSubtotalKobo: 500000,
  deliveryFeeKobo: 15000,
  serviceFeeKobo: 0,
  discountKobo: 0,
  largeOrderSurchargeKobo: 0,
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
    createOrder: vi.fn().mockResolvedValue({
      orderId: orderDetail.id,
      deliveryHandoff: {
        code: '1234',
        instruction:
          'Give this code to the rider only after you receive your order. The rider will ask for it to confirm delivery.'
      }
    }),
    findLocationType: vi.fn().mockResolvedValue('department'),
    findCustomerOrderById: vi.fn().mockResolvedValue(orderDetail),
    findPaymentStatus: vi.fn().mockResolvedValue({
      orderId: orderDetail.id,
      orderStatus: 'pending_payment',
      payment: null
    }),
    listCustomerOrders: vi.fn().mockResolvedValue([orderDetail]),
    quoteOrder: vi.fn().mockResolvedValue([quoteItem]),
    findZoneDeliveryFeeKobo: vi.fn().mockResolvedValue(null),
    findVendorServiceFeeConfig: vi.fn().mockResolvedValue(undefined)
  };
}

describe('OrdersService', () => {
  let repository: OrdersRepositoryContract;
  let service: OrdersService;

  beforeEach(() => {
    repository = createRepository();
    service = new OrdersService(repository, createEnv(), createPayments());
  });

  it('quotes order totals from available menu items', async () => {
    await expect(service.quoteOrder(customer, orderInput)).resolves.toEqual({
      currency: 'NGN',
      deliveryFeeKobo: 15000,
      serviceFeeKobo: 0,
      discountKobo: 0,
      largeOrderSurchargeKobo: 0,
      exceedsStandardCap: false,
      foodSubtotalKobo: 500000,
      items: [quoteItem],
      totalKobo: 515000
    });
  });

  it('includes the configured service fee in the quote total', async () => {
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );

    await expect(service.quoteOrder(customer, orderInput)).resolves.toEqual({
      currency: 'NGN',
      deliveryFeeKobo: 15000,
      serviceFeeKobo: 5000,
      discountKobo: 0,
      largeOrderSurchargeKobo: 0,
      exceedsStandardCap: false,
      foodSubtotalKobo: 500000,
      items: [quoteItem],
      totalKobo: 520000
    });
  });

  it('does not charge the service fee when no items count toward takeaway', async () => {
    const input: CreateOrderDto = {
      ...orderInput,
      items: [{ menuItemId: nonTakeawayQuoteItem.menuItemId, quantity: 2 }]
    };
    vi.mocked(repository.quoteOrder).mockResolvedValue([nonTakeawayQuoteItem]);
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );

    await expect(service.quoteOrder(customer, input)).resolves.toEqual({
      currency: 'NGN',
      deliveryFeeKobo: 15000,
      serviceFeeKobo: 0,
      discountKobo: 0,
      largeOrderSurchargeKobo: 0,
      exceedsStandardCap: false,
      foodSubtotalKobo: 40000,
      items: [nonTakeawayQuoteItem],
      totalKobo: 55000
    });
  });

  it('charges one flat service fee when a mixed cart contains a takeaway item', async () => {
    const input: CreateOrderDto = {
      ...orderInput,
      items: [
        { menuItemId: quoteItem.menuItemId, quantity: 2 },
        { menuItemId: nonTakeawayQuoteItem.menuItemId, quantity: 2 }
      ]
    };
    vi.mocked(repository.quoteOrder).mockResolvedValue([quoteItem, nonTakeawayQuoteItem]);
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );

    await expect(service.quoteOrder(customer, input)).resolves.toMatchObject({
      foodSubtotalKobo: 540000,
      serviceFeeKobo: 5000,
      totalKobo: 560000
    });
  });

  it('charges the takeaway fee for a single-portion item that is not a spoon unit', async () => {
    const input: CreateOrderDto = {
      ...orderInput,
      items: [{ menuItemId: singleTakeawayQuoteItem.menuItemId, quantity: 1 }]
    };
    vi.mocked(repository.quoteOrder).mockResolvedValue([singleTakeawayQuoteItem]);
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );

    await expect(service.quoteOrder(customer, input)).resolves.toMatchObject({
      foodSubtotalKobo: 300000,
      serviceFeeKobo: 5000,
      totalKobo: 320000
    });
  });

  it('passes zero service fee to order creation when no items count toward takeaway', async () => {
    const input: CreateOrderDto = {
      ...orderInput,
      items: [{ menuItemId: nonTakeawayQuoteItem.menuItemId, quantity: 2 }]
    };
    vi.mocked(repository.quoteOrder).mockResolvedValue([nonTakeawayQuoteItem]);
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );

    await service.createOrder(customer, input, 'order-key');

    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.userId,
      input,
      'order-key',
      expect.any(String),
      0,
      100_000_000,
      defaultSurchargeConfig
    );
  });

  it('prefers the zone delivery fee over the configured fallback', async () => {
    vi.mocked(repository.findZoneDeliveryFeeKobo).mockResolvedValue(25000);

    await expect(service.quoteOrder(customer, orderInput)).resolves.toEqual({
      currency: 'NGN',
      deliveryFeeKobo: 25000,
      serviceFeeKobo: 0,
      discountKobo: 0,
      largeOrderSurchargeKobo: 0,
      exceedsStandardCap: false,
      foodSubtotalKobo: 500000,
      items: [quoteItem],
      totalKobo: 525000
    });
    expect(repository.findZoneDeliveryFeeKobo).toHaveBeenCalledWith(orderInput.locationId);
  });

  it('uses the vendor service fee override, clamped to the campus ceiling', async () => {
    // Vendor set 9000 kobo, campus ceiling 6000 → clamped to 6000.
    vi.mocked(repository.findVendorServiceFeeConfig).mockResolvedValue({
      serviceFeeKobo: 9000,
      maxServiceFeeKobo: 6000
    });

    await expect(service.quoteOrder(customer, orderInput)).resolves.toMatchObject({
      serviceFeeKobo: 6000,
      totalKobo: 521000
    });
    expect(repository.findVendorServiceFeeConfig).toHaveBeenCalledWith(orderInput.vendorId);
  });

  it('falls back to the global service fee when the vendor has no override', async () => {
    service = new OrdersService(
      repository,
      createEnv({ SERVICE_FEE_KOBO: 5000 }),
      createPayments()
    );
    vi.mocked(repository.findVendorServiceFeeConfig).mockResolvedValue({
      serviceFeeKobo: null,
      maxServiceFeeKobo: 20000
    });

    await expect(service.quoteOrder(customer, orderInput)).resolves.toMatchObject({
      serviceFeeKobo: 5000
    });
  });

  it('rejects an over-cap order when the large-order surcharge is not accepted', async () => {
    // Subtotal 500000 + delivery 15000 = 515000 kobo, above the 249000 cap.
    service = new OrdersService(
      repository,
      createEnv({ MAX_ORDER_TOTAL_KOBO: 249000 }),
      createPayments()
    );

    await expect(service.createOrder(customer, orderInput, 'order-key')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('surfaces the surcharge on the quote when the total exceeds the cap', async () => {
    service = new OrdersService(
      repository,
      createEnv({ MAX_ORDER_TOTAL_KOBO: 249000 }),
      createPayments()
    );

    // Pre-surcharge total = 500000 + 15000 = 515000. Surcharge = round(515000*150/10000) + 10000
    // = 7725 + 10000 = 17725. Final total = 532725.
    await expect(service.quoteOrder(customer, orderInput)).resolves.toMatchObject({
      largeOrderSurchargeKobo: 17725,
      exceedsStandardCap: true,
      totalKobo: 532725
    });
  });

  it('creates an over-cap order when the surcharge is accepted, passing the accepted flag', async () => {
    service = new OrdersService(
      repository,
      createEnv({ MAX_ORDER_TOTAL_KOBO: 249000 }),
      createPayments()
    );
    const input: CreateOrderDto = { ...orderInput, acceptLargeOrderSurcharge: true };

    await service.createOrder(customer, input, 'order-key');

    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.userId,
      input,
      'order-key',
      expect.any(String),
      0,
      249000,
      { surchargeBps: 150, surchargeFlatKobo: 10000, accepted: true }
    );
  });

  it('passes the resolved service fee and max total to the repository on create', async () => {
    await service.createOrder(customer, orderInput, 'order-key');
    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.userId,
      orderInput,
      'order-key',
      expect.any(String),
      0,
      100_000_000,
      defaultSurchargeConfig
    );
  });

  it('requires a room number when the selected location is a hostel', async () => {
    vi.mocked(repository.findLocationType).mockResolvedValue('hostel');

    await expect(service.createOrder(customer, orderInput, 'order-key')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('allows hostel orders when a room number is provided', async () => {
    vi.mocked(repository.findLocationType).mockResolvedValue('hostel');
    const input: CreateOrderDto = { ...orderInput, roomNumber: 'B12' };

    await service.createOrder(customer, input, 'order-key');

    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.userId,
      input,
      'order-key',
      expect.any(String),
      0,
      100_000_000,
      defaultSurchargeConfig
    );
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
