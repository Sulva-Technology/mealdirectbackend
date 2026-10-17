import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../../src/database/database.service.js';
import { DvaTopupSweepService } from '../../src/modules/payments/dva-topup-sweep.service.js';
import type { PaystackClient } from '../../src/modules/payments/paystack.client.js';
import type { PaystackWebhookService } from '../../src/modules/payments/paystack-webhook.service.js';

function dvaTransaction(reference: string): Record<string, unknown> {
  return {
    reference,
    amount: 11_000,
    authorization: { channel: 'dedicated_nuban', receiver_bank_account_number: '9627217234' }
  };
}

function setup(options: {
  pages: Record<string, unknown>[][];
  alreadyCredited?: string[];
  creditFails?: string[];
}) {
  const listSuccessfulTransactions = vi.fn((_from: string, page: number) =>
    Promise.resolve({
      transactions: options.pages[page - 1] ?? [],
      pageCount: options.pages.length
    })
  );
  const verifyTransaction = vi.fn((reference: string) =>
    Promise.resolve({
      amountKobo: 11_000,
      currency: 'NGN',
      reference,
      status: 'success',
      transactionId: '1',
      providerPayload: { data: dvaTransaction(reference) }
    })
  );
  const creditVerifiedWalletTopup = vi.fn((payload: { data?: { reference?: string } }) => {
    const reference = payload.data?.reference ?? '';
    if (options.creditFails?.includes(reference)) return Promise.reject(new Error('boom'));
    return Promise.resolve({
      status: 'accepted' as const,
      eventType: 'WALLET_TOPUP_SUCCEEDED' as const,
      providerReference: reference
    });
  });

  const service = new DvaTopupSweepService(
    { listSuccessfulTransactions, verifyTransaction } as unknown as PaystackClient,
    { creditVerifiedWalletTopup } as unknown as PaystackWebhookService,
    {} as DatabaseService
  );
  vi.spyOn(service, 'creditedReferences').mockResolvedValue(new Set(options.alreadyCredited ?? []));

  return { service, listSuccessfulTransactions, verifyTransaction, creditVerifiedWalletTopup };
}

describe('DvaTopupSweepService', () => {
  it('credits only dedicated-account transfers no wallet holds yet', async () => {
    const { service, verifyTransaction, creditVerifiedWalletTopup } = setup({
      pages: [
        [
          dvaTransaction('DVA-NEW'),
          dvaTransaction('DVA-DONE'),
          { reference: 'CARD-1', authorization: { channel: 'card' } }
        ]
      ],
      alreadyCredited: ['DVA-DONE']
    });

    const result = await service.sweep(72, new Date('2026-10-17T12:30:00Z'));

    expect(result).toEqual({ seen: 2, missing: 1, credited: 1, failed: 0 });
    expect(verifyTransaction).toHaveBeenCalledExactlyOnceWith('DVA-NEW');
    expect(creditVerifiedWalletTopup).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'charge.success' })
    );
  });

  it('looks back the requested window and walks every page', async () => {
    const { service, listSuccessfulTransactions } = setup({
      pages: [[dvaTransaction('A')], [dvaTransaction('B')]],
      alreadyCredited: ['A', 'B']
    });

    const result = await service.sweep(72, new Date('2026-10-17T12:00:00Z'));

    expect(listSuccessfulTransactions).toHaveBeenNthCalledWith(1, '2026-10-14T12:00:00.000Z', 1);
    expect(listSuccessfulTransactions).toHaveBeenNthCalledWith(2, '2026-10-14T12:00:00.000Z', 2);
    expect(result).toEqual({ seen: 2, missing: 0, credited: 0, failed: 0 });
  });

  it('keeps going past a transfer that fails to credit', async () => {
    const { service } = setup({
      pages: [[dvaTransaction('BAD'), dvaTransaction('GOOD')]],
      creditFails: ['BAD']
    });

    const result = await service.sweep();

    expect(result).toEqual({ seen: 2, missing: 2, credited: 1, failed: 1 });
  });

  it('does nothing when Paystack reports no dedicated-account transfers', async () => {
    const { service, verifyTransaction } = setup({ pages: [[]] });

    expect(await service.sweep()).toEqual({ seen: 0, missing: 0, credited: 0, failed: 0 });
    expect(verifyTransaction).not.toHaveBeenCalled();
  });
});
