import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

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

describe('vendor profile, menu, payout, and availability API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a vendor JWT for Module 9 vendor endpoints', async () => {
    const endpoints = [
      {
        method: 'GET' as const,
        url: '/v1/vendor/profile'
      },
      {
        method: 'GET' as const,
        url: '/v1/vendor/payout-account'
      },
      {
        method: 'GET' as const,
        url: '/v1/vendor/menu-metadata'
      },
      {
        method: 'GET' as const,
        url: '/v1/vendor/menu-items'
      },
      {
        method: 'GET' as const,
        url: '/v1/vendor/availability'
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

  it('requires the vendor role for Module 9 vendor endpoints', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/profile',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates vendor profile and payout payloads before touching the database', async () => {
    const token = await signToken('vendor');
    const badProfile = await app.inject({
      method: 'PATCH',
      url: '/v1/vendor/profile',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        displayName: '',
        phone: 'bad-phone'
      }
    });

    expect(badProfile.statusCode).toBe(400);
    expect(badProfile.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const badPayout = await app.inject({
      method: 'PUT',
      url: '/v1/vendor/payout-account',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        accountName: '',
        accountNumber: '12',
        bankName: ''
      }
    });

    expect(badPayout.statusCode).toBe(400);
    expect(badPayout.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates vendor menu params and payloads before touching the database', async () => {
    const token = await signToken('vendor');

    const badCreate = await app.inject({
      method: 'POST',
      url: '/v1/vendor/menu-items',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: '',
        priceKobo: -1,
        unitTypeId: 'not-a-uuid'
      }
    });

    expect(badCreate.statusCode).toBe(400);
    expect(badCreate.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const badParam = await app.inject({
      method: 'PATCH',
      url: '/v1/vendor/menu-items/not-a-uuid',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Jollof Rice'
      }
    });

    expect(badParam.statusCode).toBe(400);
    expect(badParam.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates vendor availability and item schedule payloads before touching the database', async () => {
    const token = await signToken('vendor');

    const badAvailability = await app.inject({
      method: 'PUT',
      url: '/v1/vendor/availability',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        entries: [
          {
            deliverySlotId: '11111111-1111-4111-8111-111111111111',
            dayOfWeek: 7,
            available: true
          }
        ]
      }
    });

    expect(badAvailability.statusCode).toBe(400);
    expect(badAvailability.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const badSchedule = await app.inject({
      method: 'PUT',
      url: '/v1/vendor/menu-items/11111111-1111-4111-8111-111111111111/schedules',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        entries: [
          {
            deliverySlotId: 'not-a-uuid',
            dayOfWeek: 1,
            available: true
          }
        ]
      }
    });

    expect(badSchedule.statusCode).toBe(400);
    expect(badSchedule.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
