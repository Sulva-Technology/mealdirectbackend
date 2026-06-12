import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role
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

describe('settlements API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects non-admin settlement generation before touching the database', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/settlements/vendors/44444444-4444-4444-8444-444444444444/daily',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        settlementDate: '2026-06-12'
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates settlement generation input before touching the database', async () => {
    const token = await signToken('super_admin');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/settlements/vendors/not-a-uuid/daily',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        settlementDate: 'not-a-date'
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
