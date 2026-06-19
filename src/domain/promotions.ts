import { assertIntegerCents } from './money.js';

export type PromotionDiscountType = 'fixed' | 'percent';

export type Promotion = {
  id: string;
  code: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minOrderKobo: number;
  maxDiscountKobo: number | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

export type PromotionEvaluation = {
  discountKobo: number;
};

export type PromotionRejectionReason =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'below_minimum';

export class PromotionValidationError extends Error {
  constructor(public readonly reason: PromotionRejectionReason, message: string) {
    super(message);
    this.name = 'PromotionValidationError';
  }
}

/**
 * Pure promo evaluation: given a loaded promotion and the order subtotal, returns the discount
 * in kobo or throws a typed validation error. Never returns a discount exceeding the subtotal.
 */
export function evaluatePromotion(
  promo: Promotion,
  subtotalKobo: number,
  now: Date = new Date()
): PromotionEvaluation {
  const subtotal = assertIntegerCents(subtotalKobo, 'subtotalKobo');

  if (!promo.active) {
    throw new PromotionValidationError('inactive', 'Promotion code is not active.');
  }

  const nowMs = now.getTime();
  if (nowMs < new Date(promo.startsAt).getTime()) {
    throw new PromotionValidationError('not_started', 'Promotion code is not yet active.');
  }
  if (promo.endsAt !== null && nowMs > new Date(promo.endsAt).getTime()) {
    throw new PromotionValidationError('expired', 'Promotion code has expired.');
  }

  if (subtotal < promo.minOrderKobo) {
    throw new PromotionValidationError(
      'below_minimum',
      'Order subtotal is below the promotion minimum.'
    );
  }

  let discount: number;
  if (promo.discountType === 'fixed') {
    discount = promo.discountValue;
  } else {
    discount = Math.floor((subtotal * promo.discountValue) / 100);
    if (promo.maxDiscountKobo !== null) {
      discount = Math.min(discount, promo.maxDiscountKobo);
    }
  }

  return { discountKobo: Math.min(discount, subtotal) };
}
