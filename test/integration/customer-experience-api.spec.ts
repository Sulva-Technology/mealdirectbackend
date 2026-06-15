import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const orderId = '11111111-1111-4111-8111-111111111111';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role
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

describe('customer escalation and review API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a customer JWT for escalation and review mutations', async () => {
    const endpoints = [
      {
        method: 'GET' as const,
        url: `/v1/orders/${orderId}/escalations`
      },
      {
        method: 'POST' as const,
        url: `/v1/orders/${orderId}/escalations`,
        payload: {
          category: 'undelivered',
          description: 'The order never arrived.'
        }
      },
      {
        method: 'POST' as const,
        url: `/v1/orders/${orderId}/review`,
        payload: {
          vendorRating: 5
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

  it('validates escalation params and payloads before touching the database', async () => {
    const token = await signToken('customer');

    const badParam = await app.inject({
      method: 'GET',
      url: '/v1/orders/not-a-uuid/escalations',
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(badParam.statusCode).toBe(400);

    const badPayload = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/escalations`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        category: '',
        description: ''
      }
    });
    expect(badPayload.statusCode).toBe(400);
    expect(badPayload.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('validates review params and payloads before touching the database', async () => {
    const token = await signToken('customer');

    const badParam = await app.inject({
      method: 'POST',
      url: '/v1/orders/not-a-uuid/review',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        vendorRating: 5
      }
    });
    expect(badParam.statusCode).toBe(400);

    const badPayload = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/review`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        menuItemId: 'not-a-uuid',
        vendorRating: 6
      }
    });
    expect(badPayload.statusCode).toBe(400);
    expect(badPayload.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });

    const missingRating = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/review`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        comment: 'No rating included.'
      }
    });
    expect(missingRating.statusCode).toBe(400);
    expect(missingRating.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('requires customer role for escalation and review endpoints', async () => {
    const token = await signToken('vendor');
    const endpoints = [
      {
        method: 'GET' as const,
        url: `/v1/orders/${orderId}/escalations`
      },
      {
        method: 'POST' as const,
        url: `/v1/orders/${orderId}/escalations`,
        payload: {
          category: 'undelivered',
          description: 'The order never arrived.'
        }
      },
      {
        method: 'POST' as const,
        url: `/v1/orders/${orderId}/review`,
        payload: {
          vendorRating: 5
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

      expect(response.statusCode).toBe(403);
    }
  });
});
