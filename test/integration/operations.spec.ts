import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

type OperationsStatusBody = {
  status: string;
  release: {
    version: string;
    commitSha: string;
  };
  metrics: {
    requests: {
      total: number;
    };
  };
};

describe('operations endpoint', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated internal operations status requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/status'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'OPERATIONS_AUTH_REQUIRED'
      }
    });
  });

  it('returns operational status for a valid internal operations token', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/health/live',
      headers: {
        'x-request-id': 'ops-metrics-request',
        'x-trace-id': 'ops-trace'
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/status',
      headers: {
        authorization: 'Bearer test-operations-token'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<OperationsStatusBody>();

    expect(body.status).toBe('ok');
    expect(body.release).toEqual({
      version: 'test',
      commitSha: 'test-commit'
    });
    expect(body.metrics.requests.total).toBeGreaterThanOrEqual(1);
  });
});
