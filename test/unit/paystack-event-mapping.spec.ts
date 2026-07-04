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
