import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

async function signToken(role: string, subject: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      campus_id: '11111111-1111-4111-8111-111111111111'
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('wallet API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a JWT to read the wallet', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/wallet' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses non-customer roles', async () => {
    const token = await signToken('rider', '22222222-2222-4222-8222-222222222222');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an over-large ledger page before touching the database', async () => {
    const token = await signToken('customer', '33333333-3333-4333-8333-333333333333');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wallet/ledger?limit=9999',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(400);
  });

  it('requires an admin JWT for the wallet list', async () => {
    const token = await signToken('customer', '33333333-3333-4333-8333-333333333333');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/wallets',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an adjustment with no reason', async () => {
    const token = await signToken('super_admin', '44444444-4444-4444-8444-444444444444');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/wallets/55555555-5555-4555-8555-555555555555/adjust',
      headers: { authorization: `Bearer ${token}` },
      payload: { amountKobo: 100000 }
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown platform setting key', async () => {
    const token = await signToken('super_admin', '44444444-4444-4444-8444-444444444444');
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'drop_all_tables', value: 1 }
    });
    expect(response.statusCode).toBe(400);
  });
});
