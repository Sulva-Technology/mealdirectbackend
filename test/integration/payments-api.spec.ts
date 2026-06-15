import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string): Promise<string> {
  const campusId = '11111111-1111-4111-8111-111111111111';
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'campus_admin' ? { campus_id: campusId } : {})
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

describe('payments API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a customer JWT to initialize a Paystack payment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/11111111-1111-4111-8111-111111111111/payments/paystack/initialize'
    });

    expect(response.statusCode).toBe(401);
  });

  it('validates customer payment initialization params before touching the database', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/not-a-uuid/payments/paystack/initialize',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('requires admin roles for admin payment reads', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/payments',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates admin payment params before touching the database', async () => {
    const token = await signToken('campus_admin');
    const endpoints = [
      {
        method: 'GET' as const,
        url: '/v1/admin/payments/not-a-uuid'
      },
      {
        method: 'POST' as const,
        url: '/v1/admin/payments/not-a-uuid/reconcile'
      },
      {
        method: 'POST' as const,
        url: '/v1/admin/payments/not-a-uuid/refunds',
        payload: {
          amountKobo: 1000,
          reasonCode: 'customer_escalation'
        }
      }
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url,
        headers: {
          authorization: `Bearer ${token}`
        },
        ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload })
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_FAILED'
        }
      });
    }
  });

  it('validates refund payloads before touching the database', async () => {
    const token = await signToken('campus_admin');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/payments/11111111-1111-4111-8111-111111111111/refunds',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        amountKobo: 0,
        reasonCode: ''
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });
});
