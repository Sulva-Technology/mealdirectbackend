import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signCustomerToken(): Promise<string> {
  return new SignJWT({
    email: 'student@example.com',
    app_metadata: {
      meal_direct_role: 'customer',
      campus_id: '11111111-1111-4111-8111-111111111111'
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

describe('orders API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a customer JWT to create an order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: {
        'idempotency-key': 'order-key-1'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it('validates order creation input before touching the database', async () => {
    const token = await signCustomerToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'order-key-2'
      },
      payload: {
        campusId: 'not-a-uuid',
        items: []
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
