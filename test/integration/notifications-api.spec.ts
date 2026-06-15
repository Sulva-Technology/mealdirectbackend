import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signCustomerToken(): Promise<string> {
  return new SignJWT({
    email: 'student@example.com',
    app_metadata: {
      meal_direct_role: 'customer'
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

describe('notifications API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a JWT for notification reads and mutations', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/v1/notifications' },
      {
        method: 'POST' as const,
        url: '/v1/notifications/11111111-1111-4111-8111-111111111111/read'
      },
      { method: 'POST' as const, url: '/v1/notifications/read-all' },
      { method: 'GET' as const, url: '/v1/notifications/preferences' },
      { method: 'PUT' as const, url: '/v1/notifications/preferences', payload: {} }
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

  it('validates notification query and params before touching the database', async () => {
    const token = await signCustomerToken();

    const badQuery = await app.inject({
      method: 'GET',
      url: '/v1/notifications?limit=0',
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(badQuery.statusCode).toBe(400);

    const badParam = await app.inject({
      method: 'POST',
      url: '/v1/notifications/not-a-uuid/read',
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(badParam.statusCode).toBe(400);
  });

  it('validates notification preference payloads before touching the database', async () => {
    const token = await signCustomerToken();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        pushEnabled: 'yes'
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
