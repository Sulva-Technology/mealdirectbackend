import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { BatchesService } from '../../src/modules/batches/batches.service.js';
import type { BatchDetail } from '../../src/modules/batches/batches.types.js';

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

const mockBatch: BatchDetail = {
  id: '44444444-4444-4444-8444-444444444444',
  campusId: '55555555-5555-4555-8555-555555555555',
  vendorId: '11111111-1111-4111-8111-111111111111',
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
  updatedAt: '2026-06-15T12:00:00.000Z',
  orders: []
};

describe('vendor batches API', () => {
  let app: NestFastifyApplication;
  let service: BatchesService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = app.get(BatchesService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a vendor JWT for vendor batches endpoints', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/v1/vendor/batches' },
      { method: 'GET' as const, url: '/v1/vendor/batches/44444444-4444-4444-8444-444444444444' },
      {
        method: 'POST' as const,
        url: '/v1/vendor/batches/44444444-4444-4444-8444-444444444444/pickup'
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

  it('requires vendor role for vendor batches endpoints', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/batches',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('validates query parameters before calling service', async () => {
    const token = await signToken('vendor');

    // Bad status
    const badStatus = await app.inject({
      method: 'GET',
      url: '/v1/vendor/batches?status=invalid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badStatus.statusCode).toBe(400);

    // Bad date format
    const badDate = await app.inject({
      method: 'GET',
      url: '/v1/vendor/batches?date=15/06/2026',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badDate.statusCode).toBe(400);
  });

  it('validates UUID params before calling service', async () => {
    const token = await signToken('vendor');
    const badParam = await app.inject({
      method: 'GET',
      url: '/v1/vendor/batches/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badParam.statusCode).toBe(400);
  });

  it('lists vendor batches successfully with valid token', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'listBatches').mockResolvedValue([mockBatch]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/batches?status=closed&date=2026-06-15',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: BatchDetail[] }>();
    expect(json.data).toBeInstanceOf(Array);
    expect(json.data[0]).toMatchObject({ id: mockBatch.id });
  });

  it('gets batch details successfully with valid token', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'getBatch').mockResolvedValue(mockBatch);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/vendor/batches/${mockBatch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: BatchDetail }>();
    expect(json.data).toMatchObject({ id: mockBatch.id });
  });

  it('marks batch ready for pickup (pickupBatch) successfully', async () => {
    const token = await signToken('vendor');
    vi.spyOn(service, 'pickupBatch').mockResolvedValue({ ...mockBatch, status: 'in_progress' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendor/batches/${mockBatch.id}/pickup`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ data: BatchDetail }>();
    expect(json.data.status).toBe('in_progress');
  });
});
