import { describe, expect, it, vi } from 'vitest';

import type { OutboxEvent } from '../../src/worker/outbox.repository.js';
import { WalletDvaHandler } from '../../src/worker/handlers/wallet-dva.handler.js';

const event: OutboxEvent = {
  id: 'e1',
  eventType: 'wallet.dva_requested',
  aggregateType: 'wallet',
  aggregateId: '33333333-3333-4333-8333-333333333333',
  payload: { wallet_id: '33333333-3333-4333-8333-333333333333', user_id: 'u1' },
  attempts: 0
};

function createReads() {
  return {
    findWalletOwner: vi.fn().mockResolvedValue({
      walletId: event.aggregateId,
      userId: 'u1',
      email: 'student@example.com',
      displayName: 'Ada Lovelace'
    }),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    upsertDedicatedAccount: vi.fn().mockResolvedValue(undefined)
  };
}

function createPaystack() {
  return {
    createCustomer: vi.fn().mockResolvedValue({ customerCode: 'CUS_abc', providerPayload: {} }),
    createDedicatedAccount: vi.fn().mockResolvedValue({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank',
      providerPayload: {}
    })
  };
}

describe('WalletDvaHandler', () => {
  it('does nothing while the DVA flag is off', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, false);

    await handler.handle(event);

    expect(paystack.createCustomer).not.toHaveBeenCalled();
    expect(reads.upsertDedicatedAccount).not.toHaveBeenCalled();
  });

  it('provisions a customer then an account and stores the result as active', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, true);

    await handler.handle(event);

    expect(paystack.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'student@example.com' })
    );
    expect(paystack.createDedicatedAccount).toHaveBeenCalledWith({ customerCode: 'CUS_abc' });
    expect(reads.upsertDedicatedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountNumber: '9900001111', status: 'active' })
    );
  });

  it('skips a wallet that already has an active account', async () => {
    const reads = createReads();
    reads.findDedicatedAccount = vi.fn().mockResolvedValue({ status: 'active' });
    const paystack = createPaystack();
    const handler = new WalletDvaHandler(reads, paystack, true);

    await handler.handle(event);

    expect(paystack.createCustomer).not.toHaveBeenCalled();
  });

  it('records a failed status and rethrows so the outbox retries', async () => {
    const reads = createReads();
    const paystack = createPaystack();
    paystack.createDedicatedAccount = vi.fn().mockRejectedValue(new Error('paystack 503'));
    const handler = new WalletDvaHandler(reads, paystack, true);

    await expect(handler.handle(event)).rejects.toThrow('paystack 503');
    expect(reads.upsertDedicatedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});
