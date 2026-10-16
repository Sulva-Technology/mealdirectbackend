import { describe, expect, it } from 'vitest';

import { mapPaystackEvent } from '../../src/domain/payments.js';

describe('mapPaystackEvent', () => {
  it('carries amount and currency on a charge.success so the webhook path can validate both', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: { reference: 'MD-1', amount: 4500, currency: 'NGN' }
    });
    expect(event).toEqual({
      type: 'PAYMENT_SUCCEEDED',
      providerReference: 'MD-1',
      amountKobo: 4500,
      currency: 'NGN'
    });
  });

  it('omits currency when Paystack does not send one', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: { reference: 'MD-2', amount: 4500 }
    });
    expect(event).toMatchObject({ type: 'PAYMENT_SUCCEEDED', amountKobo: 4500 });
    expect(event).not.toHaveProperty('currency');
  });

  it('ignores events without a reference', () => {
    const event = mapPaystackEvent({ event: 'charge.success', data: { amount: 4500 } });
    expect(event).toMatchObject({ type: 'IGNORED', reason: 'MISSING_REFERENCE' });
  });

  it('ignores unmapped event types', () => {
    const event = mapPaystackEvent({ event: 'customer.created', data: { reference: 'X' } });
    expect(event).toMatchObject({ type: 'IGNORED', reason: 'UNMAPPED_EVENT' });
  });
});

describe('dedicated virtual account top-ups', () => {
  it('maps a dedicated_nuban charge.success to a wallet top-up', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        id: 987654,
        reference: 'PSTK-TRF-9001',
        amount: 1000000,
        currency: 'NGN',
        authorization: {
          channel: 'dedicated_nuban',
          receiver_bank_account_number: '9900001111',
          sender_name: 'ADA LOVELACE'
        }
      }
    });

    expect(event).toEqual({
      type: 'WALLET_TOPUP_SUCCEEDED',
      providerReference: 'PSTK-TRF-9001',
      amountKobo: 1000000,
      accountNumber: '9900001111',
      senderName: 'ADA LOVELACE',
      currency: 'NGN'
    });
  });

  it('still maps an ordinary card charge.success to a payment', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'MD-0104',
        amount: 45000,
        currency: 'NGN',
        authorization: { channel: 'card' }
      }
    });

    expect(event.type).toBe('PAYMENT_SUCCEEDED');
  });

  it('reads the account number from the data root when Paystack puts it there', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'PSTK-TRF-9002',
        amount: 500000,
        authorization: { channel: 'dedicated_nuban' },
        receiver_bank_account_number: '9900002222'
      }
    });

    expect(event).toMatchObject({
      type: 'WALLET_TOPUP_SUCCEEDED',
      accountNumber: '9900002222'
    });
  });

  it('routes a checkout-funded wallet top-up by metadata user id', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'WTU-1',
        amount: 500000,
        currency: 'NGN',
        metadata: { purpose: 'wallet_topup', userId: '11111111-1111-4111-8111-111111111111' }
      }
    });
    expect(event).toEqual({
      type: 'WALLET_TOPUP_SUCCEEDED',
      providerReference: 'WTU-1',
      amountKobo: 500000,
      userId: '11111111-1111-4111-8111-111111111111',
      currency: 'NGN'
    });
  });

  it('accepts top-up metadata delivered as a JSON string', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'WTU-2',
        amount: 500000,
        metadata: JSON.stringify({ purpose: 'wallet_topup', userId: 'u1' })
      }
    });
    expect(event).toMatchObject({ type: 'WALLET_TOPUP_SUCCEEDED', userId: 'u1' });
  });

  it('keeps order payments on the order path when metadata is not a top-up', () => {
    const event = mapPaystackEvent({
      event: 'charge.success',
      data: { reference: 'MD-3', amount: 4500, metadata: { orderId: 'o1' } }
    });
    expect(event).toMatchObject({ type: 'PAYMENT_SUCCEEDED' });
  });
});
