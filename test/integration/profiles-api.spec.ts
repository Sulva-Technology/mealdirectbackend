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
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('profiles API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication for the current user endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me'
    });

    expect(response.statusCode).toBe(401);
  });

  it('validates profile update input before touching the database', async () => {
    const token = await signCustomerToken();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        displayName: '',
        phoneNumber: 'bad-phone'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('validates onboarding input before touching the database', async () => {
    const token = await signCustomerToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/complete-onboarding',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        defaultCampusId: 'not-a-uuid',
        defaultLocationId: 'also-not-a-uuid',
        phoneNumber: 'bad-phone'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('validates default location input before touching the database', async () => {
    const token = await signCustomerToken();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/default-location',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        campusId: 'not-a-uuid',
        locationId: 'also-not-a-uuid'
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
