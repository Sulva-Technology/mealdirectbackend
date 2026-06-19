import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '../../src/config/env.service.js';
import { PaystackClient } from '../../src/modules/payments/paystack.client.js';

function makeEnv(): EnvService {
  return {
    get(key: string): unknown {
      if (key === 'PAYSTACK_SECRET_KEY') return 'sk_test_secret';
      if (key === 'PAYSTACK_BASE_URL') return 'https://api.paystack.test';
      return undefined;
    }
  } as unknown as EnvService;
}

function mockFetchOnce(data: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: true, message: 'ok', data })
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PaystackClient transfers', () => {
  let client: PaystackClient;

  beforeEach(() => {
    client = new PaystackClient(makeEnv());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a transfer recipient via /transferrecipient', async () => {
    const fetchMock = mockFetchOnce({ recipient_code: 'RCP_123' });

    const result = await client.createTransferRecipient({
      name: 'Ada Vendor',
      accountNumber: '0001112223',
      bankCode: '058',
      currency: 'NGN'
    });

    expect(result.recipientCode).toBe('RCP_123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paystack.test/transferrecipient');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: 'nuban',
      account_number: '0001112223',
      bank_code: '058'
    });
  });

  it('initiates a transfer via /transfer from the balance source', async () => {
    const fetchMock = mockFetchOnce({ transfer_code: 'TRF_999', status: 'pending' });

    const result = await client.initiateTransfer({
      amountKobo: 750000,
      recipientCode: 'RCP_123',
      reference: 'settlement-1',
      reason: 'Daily settlement'
    });

    expect(result).toMatchObject({ transferCode: 'TRF_999', status: 'pending' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paystack.test/transfer');
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'balance',
      amount: 750000,
      recipient: 'RCP_123',
      reference: 'settlement-1'
    });
  });
});
