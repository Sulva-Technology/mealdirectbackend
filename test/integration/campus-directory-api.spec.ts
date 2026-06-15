import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: 'admin@example.com',
    app_metadata: {
      meal_direct_role: role,
      campus_id: '11111111-1111-4111-8111-111111111111'
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('campus directory API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('validates public campus location params before database access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/campuses/not-a-uuid/locations'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates public delivery slot date filters before database access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/campuses/11111111-1111-4111-8111-111111111111/delivery-slots?date=bad-date'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('requires admin authentication for campus writes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/campuses',
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects customer JWTs on admin campus writes', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/campuses',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates admin campus payloads before database access', async () => {
    const token = await signToken('super_admin');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/campuses',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        currency: 'ngn',
        name: '',
        slug: 'Bad Slug'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
