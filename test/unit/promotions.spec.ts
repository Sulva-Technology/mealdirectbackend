import { describe, expect, it } from 'vitest';

import {
  evaluatePromotion,
  PromotionValidationError,
  type Promotion
} from '../../src/domain/promotions.js';

function makePromo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'p1',
    code: 'SAVE',
    discountType: 'fixed',
    discountValue: 5000,
    minOrderKobo: 0,
    maxDiscountKobo: null,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    active: true,
    ...overrides
  };
}

const now = new Date('2026-06-15T12:00:00.000Z');

describe('evaluatePromotion', () => {
  it('rejects inactive codes', () => {
    expect(() => evaluatePromotion(makePromo({ active: false }), 100000, now)).toThrow(
      PromotionValidationError
    );
  });

  it('rejects codes that have not started', () => {
    const promo = makePromo({ startsAt: '2026-07-01T00:00:00.000Z' });
    expect(() => evaluatePromotion(promo, 100000, now)).toThrow(/not yet active/);
  });

  it('rejects expired codes', () => {
    const promo = makePromo({ endsAt: '2026-06-01T00:00:00.000Z' });
    expect(() => evaluatePromotion(promo, 100000, now)).toThrow(/expired/);
  });

  it('rejects subtotals below the minimum', () => {
    const promo = makePromo({ minOrderKobo: 200000 });
    expect(() => evaluatePromotion(promo, 100000, now)).toThrow(/minimum/);
  });

  it('computes a fixed discount', () => {
    expect(evaluatePromotion(makePromo({ discountValue: 5000 }), 100000, now)).toEqual({
      discountKobo: 5000
    });
  });

  it('computes a percent discount capped at the maximum', () => {
    const promo = makePromo({
      discountType: 'percent',
      discountValue: 25,
      maxDiscountKobo: 20000
    });
    expect(evaluatePromotion(promo, 100000, now)).toEqual({ discountKobo: 20000 });
  });

  it('computes an uncapped percent discount', () => {
    const promo = makePromo({ discountType: 'percent', discountValue: 10, maxDiscountKobo: null });
    expect(evaluatePromotion(promo, 100000, now)).toEqual({ discountKobo: 10000 });
  });

  it('never returns a discount exceeding the subtotal', () => {
    const promo = makePromo({ discountType: 'fixed', discountValue: 500000 });
    expect(evaluatePromotion(promo, 100000, now)).toEqual({ discountKobo: 100000 });
  });
});
