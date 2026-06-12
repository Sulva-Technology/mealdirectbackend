import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';

const webhookPath = '/v1/payments/webhooks/paystack';
const secret = 'test-paystack-secret';

function sign(rawBody: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

describe('Paystack webhook endpoint', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects missing webhook signatures', async () => {
    const response = await app.inject({
      method: 'POST',
      url: webhookPath,
      payload: {
        event: 'charge.success',
        data: {
          reference: 'MD-paystack-1',
          amount: 4500
        }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('accepts a correctly signed payment success webhook', async () => {
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'MD-paystack-2',
        amount: 4500
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: webhookPath,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': sign(rawBody)
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'accepted',
      eventType: 'PAYMENT_SUCCEEDED',
      providerReference: 'MD-paystack-2'
    });
  });

  it('treats duplicate webhook deliveries as idempotent duplicates', async () => {
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'MD-paystack-duplicate',
        amount: 4500
      }
    });
    const headers = {
      'content-type': 'application/json',
      'x-paystack-signature': sign(rawBody)
    };

    await app.inject({
      method: 'POST',
      url: webhookPath,
      headers,
      payload: rawBody
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: webhookPath,
      headers,
      payload: rawBody
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      status: 'duplicate',
      providerReference: 'MD-paystack-duplicate'
    });
  });
});
