import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import type { OrderDetail } from '../../src/modules/orders/orders.types.js';
import { VendorOrdersService } from '../../src/modules/vendors/vendor-orders.service.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'vendor' ? { vendor_id: '11111111-1111-4111-8111-111111111111' } : {})
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('22222222-2222-4222-8222-222222222222')
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

const mockOrder: OrderDetail = {
  id: '44444444-4444-4444-8444-444444444444',
  orderNumber: 'MD-20260615-123456',
  customerId: '55555555-5555-4555-8555-555555555555',
  campusId: '66666666-6666-4666-8666-666666666666',
  vendorId: '11111111-1111-4111-8111-111111111111',
  vendorDisplayName: 'Ada Kitchen',
  serviceDate: '2026-06-15',
  deliverySlotId: '77777777-7777-4777-8777-777777777777',
  deliverySlotName: 'Lunch Slot',
  locationId: '88888888-8888-4888-8888-888888888888',
  locationName: 'Main gate',
  orderStatus: 'paid',
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
  confirmedAt: null,
  items: [],
  latestPayment: null
};

describe('vendor orders API', () => {
  let app: NestFastifyApplication;
  let service: VendorOrdersService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = app.get(VendorOrdersService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a vendor JWT for vendor orders endpoints', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/v1/vendor/orders' },
      { method: 'GET' as const, url: '/v1/vendor/orders/44444444-4444-4444-8444-444444444444' },
      {
        method: 'POST' as const,
        url: '/v1/vendor/orders/44444444-4444-4444-8444-444444444444/accept'
      },
      {
        method: 'POST' as const,
        url: '/v1/vendor/orders/44444444-4444-4444-8444-444444444444/prepare'
      },
      {
        method: 'POST' as const,
        url: '/v1/vendor/orders/44444444-4444-4444-8444-444444444444/ready'
      }
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('requires vendor role for vendor orders endpoints', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/orders',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('validates list queries before invoking service', async () => {
    const token = await signToken('vendor');

    // Bad status
    const badStatusResponse = await app.inject({
      method: 'GET',
      url: '/v1/vendor/orders?status=invalid_status',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badStatusResponse.statusCode).toBe(400);

    // Bad date format
    const badDateResponse = await app.inject({
      method: 'GET',
      url: '/v1/vendor/orders?date=15-06-2026',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badDateResponse.statusCode).toBe(400);
  });

  it('validates UUID params before invoking service', async () => {
    const token = await signToken('vendor');
    const badUuidResponse = await app.inject({
      method: 'GET',
      url: '/v1/vendor/orders/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badUuidResponse.statusCode).toBe(400);
  });

  it('lists vendor orders successfully with valid token', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'listOrders').mockResolvedValue([mockOrder]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/orders?status=paid&date=2026-06-15',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: OrderDetail[] }>();
    expect(json.data).toBeInstanceOf(Array);
    expect(json.data[0]).toMatchObject({ id: mockOrder.id });
  });

  it('gets order detail successfully with valid token', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'getOrder').mockResolvedValue(mockOrder);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/vendor/orders/${mockOrder.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: OrderDetail }>();
    expect(json.data).toMatchObject({ id: mockOrder.id });
  });

  it('accepts order successfully with valid token', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'acceptOrder').mockResolvedValue({ ...mockOrder, orderStatus: 'accepted' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendor/orders/${mockOrder.id}/accept`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: OrderDetail }>();
    expect(json.data.orderStatus).toBe('accepted');
  });
});
