import { BadGatewayException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvService } from '../../src/config/env.service.js';
import { PaystackClient } from '../../src/modules/payments/paystack.client.js';

function createEnv(): EnvService {
  const values: Record<string, unknown> = {
    PAYSTACK_BASE_URL: 'https://api.paystack.co',
    PAYSTACK_SECRET_KEY: 'sk_test_xxx',
    APP_URL_CUSTOMER: 'https://user.mealdirectly.com',
    WALLET_DVA_PROVIDER: 'test-bank'
  };
  return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

describe('PaystackClient dedicated accounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a customer and returns its code', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { customer_code: 'CUS_abc123' } }), {
        status: 200
      })
    );

    const client = new PaystackClient(createEnv());
    const result = await client.createCustomer({
      email: 'student@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });

    expect(result.customerCode).toBe('CUS_abc123');
  });

  it('creates a dedicated account and returns the bank details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            account_number: '9900001111',
            account_name: 'MEALDIRECT / ADA LOVELACE',
            bank: { name: 'Wema Bank', slug: 'wema-bank' }
          }
        }),
        { status: 200 }
      )
    );

    const client = new PaystackClient(createEnv());
    const result = await client.createDedicatedAccount({ customerCode: 'CUS_abc123' });

    expect(result).toMatchObject({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank'
    });
  });

  it('sends the customer name and phone with the dedicated-account request', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            account_number: '9900001111',
            account_name: 'MEALDIRECT / ADA LOVELACE',
            bank: { name: 'Wema Bank', slug: 'wema-bank' }
          }
        }),
        { status: 200 }
      )
    );

    await new PaystackClient(createEnv()).createDedicatedAccount({
      customerCode: 'CUS_abc123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+2348031234567'
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      customer: 'CUS_abc123',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+2348031234567'
    });
  });

  it('rejects a dedicated-account response missing the account number', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { bank: { name: 'Wema Bank' } } }), {
        status: 200
      })
    );

    const client = new PaystackClient(createEnv());
    await expect(
      client.createDedicatedAccount({ customerCode: 'CUS_abc123' })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
