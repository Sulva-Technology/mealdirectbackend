import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

// Rate limiting keys on request.ip, so the client IP must come from exactly one trusted
// proxy hop (Render's edge): not the proxy itself, and not a spoofed earlier entry.
describe('trust proxy', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get('/__test/ip', (request) => ({ ip: request.ip }));
    await app.init();
    await fastify.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('takes the client IP from the last X-Forwarded-For hop only', async () => {
    const response = await app.inject({
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
      method: 'GET',
      remoteAddress: '10.0.0.1',
      url: '/__test/ip'
    });

    expect(response.json()).toEqual({ ip: '203.0.113.7' });
  });

  it('uses the socket address when there is no forwarding header', async () => {
    const response = await app.inject({
      method: 'GET',
      remoteAddress: '10.0.0.1',
      url: '/__test/ip'
    });

    expect(response.json()).toEqual({ ip: '10.0.0.1' });
  });
});
