import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const inventoryId = '11111111-1111-4111-8111-111111111111';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'vendor' ? { vendor_id: '22222222-2222-4222-8222-222222222222' } : {})
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('33333333-3333-4333-8333-333333333333')
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('vendor inventory API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a vendor JWT for inventory endpoints', async () => {
    const endpoints = [
      {
        method: 'GET' as const,
        url: '/v1/vendor/inventory?date=2026-06-16'
      },
      {
        method: 'PUT' as const,
        url: `/v1/vendor/inventory/${inventoryId}`,
        payload: {
          quantityTotal: 10
        }
      },
      {
        method: 'POST' as const,
        url: `/v1/vendor/inventory/${inventoryId}/adjustments`,
        payload: {
          adjustmentQuantity: 5,
          reason: 'Extra portions cooked'
        }
      }
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url,
        ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload })
      });

      expect(response.statusCode).toBe(401);
    }
  });

  it('requires the vendor role for inventory endpoints', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/inventory?date=2026-06-16',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates inventory list filters before touching the database', async () => {
    const token = await signToken('vendor');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/inventory?date=bad-date&slotId=not-a-uuid',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates inventory update params and payloads before touching the database', async () => {
    const token = await signToken('vendor');
    const badParam = await app.inject({
      method: 'PUT',
      url: '/v1/vendor/inventory/not-a-uuid',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        quantityTotal: 10
      }
    });

    expect(badParam.statusCode).toBe(400);
    expect(badParam.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const badPayload = await app.inject({
      method: 'PUT',
      url: `/v1/vendor/inventory/${inventoryId}`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        expectedVersion: 0,
        quantityTotal: -1
      }
    });

    expect(badPayload.statusCode).toBe(400);
    expect(badPayload.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates adjustment params and payloads before touching the database', async () => {
    const token = await signToken('vendor');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendor/inventory/${inventoryId}/adjustments`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        adjustmentQuantity: 0,
        metadata: [],
        reason: ''
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
