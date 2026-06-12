import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const testSecret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const issuer = 'http://127.0.0.1:54321/auth/v1';
const audience = 'authenticated';
const subject = '11111111-1111-4111-8111-111111111111';

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    email: 'student@example.com',
    app_metadata: {
      meal_direct_role: 'campus_admin',
      campus_id: 'campus-a'
    },
    ...overrides
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(testSecret);
}

describe('Supabase JWT authentication', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects protected routes without a bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('rejects expired JWTs', async () => {
    const token = await new SignJWT({ email: 'student@example.com' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(testSecret);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('returns a filtered actor context for a valid Supabase JWT', async () => {
    const token = await signToken();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      actor: {
        userId: subject,
        email: 'student@example.com',
        role: 'campus_admin',
        campusId: 'campus-a'
      }
    });
  });
});
