import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { DeviceTokensRepository } from '../../src/modules/notifications/device-tokens.repository.js';
import { PushChannel } from '../../src/notifications/channels/push.channel.js';

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

describe('device tokens API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a JWT for device token registration and removal', async () => {
    const endpoints = [
      {
        method: 'POST' as const,
        url: '/v1/me/device-tokens',
        payload: { token: 'abc', platform: 'web' }
      },
      { method: 'DELETE' as const, url: '/v1/me/device-tokens/abc' }
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

  it('validates the device token payload before touching the database', async () => {
    const token = await signCustomerToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/device-tokens',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        token: '',
        platform: 'desktop'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED'
      }
    });
  });

  it('registers and removes a device token for the authenticated user', async () => {
    const token = await signCustomerToken();
    const repository = app.get(DeviceTokensRepository);
    const registerSpy = vi.spyOn(repository, 'register').mockResolvedValue(undefined);
    const removeSpy = vi.spyOn(repository, 'remove').mockResolvedValue(undefined);

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/me/device-tokens',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        token: 'integration-test-device-token',
        platform: 'android'
      }
    });
    expect(registered.statusCode).toBe(204);
    expect(registerSpy).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'integration-test-device-token',
      'android'
    );

    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/me/device-tokens/integration-test-device-token',
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(removed.statusCode).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'integration-test-device-token'
    );
  });

  it('sends a test push to the authenticated user active tokens', async () => {
    const token = await signCustomerToken();
    const push = app.get(PushChannel);
    const deliverSpy = vi.spyOn(push, 'deliverToUser').mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/device-tokens/test',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(204);
    expect(deliverSpy).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      to: '22222222-2222-4222-8222-222222222222',
      title: 'Meal Direct test notification',
      body: 'Push notifications are connected.',
      linkPath: '/notifications'
    });
  });
});
