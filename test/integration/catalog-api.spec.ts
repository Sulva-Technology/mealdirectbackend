import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

describe('catalog API', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('validates vendor list filters before database access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/vendors?campusId=not-a-uuid&date=bad-date&slotId=also-bad'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates vendor detail params before database access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/vendors/not-a-uuid'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('validates vendor menu filters before database access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/vendors/11111111-1111-4111-8111-111111111111/menu?date=bad-date'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
