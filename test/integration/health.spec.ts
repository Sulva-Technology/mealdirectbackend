import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { JsonLogger } from '../../src/common/logging/json-logger.service.js';

describe('health endpoints', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns liveness without requiring database connectivity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health/live',
      headers: {
        'x-request-id': 'test-live-request'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('test-live-request');
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.json()).toMatchObject({
      status: 'ok',
      release: {
        version: 'test',
        commitSha: 'test-commit'
      }
    });
  });

  it('returns readiness failure when the database is unavailable', async () => {
    const logger = app.get(JsonLogger);
    const errorSpy = vi.spyOn(logger, 'error');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/health/ready',
      headers: {
        'x-request-id': 'test-ready-request'
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is unavailable.'
      },
      requestId: 'test-ready-request'
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({
      message: 'Database health check failed'
    });
    expect(errorSpy.mock.calls[0]?.[2]).toBe('HealthController');
  });

  it('returns the consistent error envelope for unknown routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/missing-route',
      headers: {
        'x-request-id': 'test-missing-request'
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'NOT_FOUND'
      },
      requestId: 'test-missing-request'
    });
  });

  it('does not treat disallowed CORS preflight as an internal server error', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/me',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization'
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
