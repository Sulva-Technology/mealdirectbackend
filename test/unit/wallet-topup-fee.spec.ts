import { describe, expect, it } from 'vitest';

import {
  calculateTopupCharge,
  splitDedicatedAccountDeposit
} from '../../src/domain/wallet-topup-fee.js';

// Paystack's net after its fee (1.5% + ₦100, ₦100 waived below ₦2,500, capped at ₦2,000).
function paystackNet(chargeKobo: number): number {
  const flat = chargeKobo < 250_000 ? 0 : 10_000;
  const fee = Math.min(Math.round(chargeKobo * 0.015) + flat, 200_000);
  return chargeKobo - fee;
}

describe('calculateTopupCharge', () => {
  it.each([50_000, 100_000, 240_000, 250_000, 500_000, 1_000_000, 5_000_000, 20_000_000])(
    'grosses up %i kobo so the net after Paystack fees covers the credit',
    (creditKobo) => {
      const { chargeKobo, feeKobo } = calculateTopupCharge(creditKobo);
      expect(chargeKobo).toBe(creditKobo + feeKobo);
      expect(paystackNet(chargeKobo)).toBeGreaterThanOrEqual(creditKobo);
      // Never over-collect by more than a couple of kobo.
      expect(paystackNet(chargeKobo) - creditKobo).toBeLessThanOrEqual(3);
    }
  );

  it('waives the ₦100 flat fee below ₦2,500', () => {
    expect(calculateTopupCharge(100_000).feeKobo).toBeLessThan(10_000);
  });

  it('caps the fee at ₦2,000', () => {
    expect(calculateTopupCharge(20_000_000)).toEqual({
      creditKobo: 20_000_000,
      feeKobo: 200_000,
      chargeKobo: 20_200_000
    });
  });

  it('charges no fee when fees are absorbed', () => {
    expect(calculateTopupCharge(500_000, false)).toEqual({
      creditKobo: 500_000,
      feeKobo: 0,
      chargeKobo: 500_000
    });
  });
});

describe('splitDedicatedAccountDeposit', () => {
  it('takes 1% off a dedicated-account transfer', () => {
    expect(splitDedicatedAccountDeposit(1_000_000, 100)).toEqual({
      depositFeeKobo: 10_000,
      creditKobo: 990_000
    });
  });

  it('rounds to the nearest kobo', () => {
    expect(splitDedicatedAccountDeposit(12_345, 100)).toEqual({
      depositFeeKobo: 123,
      creditKobo: 12_222
    });
  });

  it('takes nothing when the fee is off', () => {
    expect(splitDedicatedAccountDeposit(1_000_000, 0)).toEqual({
      depositFeeKobo: 0,
      creditKobo: 1_000_000
    });
  });

  it('never consumes the whole transfer', () => {
    expect(splitDedicatedAccountDeposit(1, 10_000).creditKobo).toBe(1);
    expect(splitDedicatedAccountDeposit(100, 10_000).creditKobo).toBe(1);
  });
});
