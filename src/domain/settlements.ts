import { assertIntegerCents, calculateBasisPointsAmount } from './money.js';

export type DeliveryEarningsInput = {
  baseFeeCents: number;
  perOrderFeeCents: number;
  orderCount: number;
  distanceFeeCents?: number;
  bonusCents?: number;
  penaltyCents?: number;
};

export type VendorSettlementInput = {
  foodGrossCents: number;
  commissionBasisPoints: number;
  refundCents?: number;
  adjustmentCents?: number;
};

export type RiderSettlementInput = {
  deliveryEarningsCents: readonly number[];
  bonusCents?: number;
  penaltyCents?: number;
};

export function calculateDeliveryEarnings(input: DeliveryEarningsInput): number {
  const baseFeeCents = assertIntegerCents(input.baseFeeCents, 'baseFeeCents');
  const perOrderFeeCents = assertIntegerCents(input.perOrderFeeCents, 'perOrderFeeCents');
  const distanceFeeCents = assertIntegerCents(input.distanceFeeCents ?? 0, 'distanceFeeCents');
  const bonusCents = assertIntegerCents(input.bonusCents ?? 0, 'bonusCents');
  const penaltyCents = assertIntegerCents(input.penaltyCents ?? 0, 'penaltyCents');

  if (!Number.isInteger(input.orderCount) || input.orderCount <= 0) {
    throw new RangeError('orderCount must be a positive integer.');
  }

  return Math.max(
    0,
    baseFeeCents +
      perOrderFeeCents * input.orderCount +
      distanceFeeCents +
      bonusCents -
      penaltyCents
  );
}

export function calculateVendorSettlement(input: VendorSettlementInput): {
  grossCents: number;
  commissionCents: number;
  refundCents: number;
  adjustmentCents: number;
  netPayableCents: number;
} {
  const grossCents = assertIntegerCents(input.foodGrossCents, 'foodGrossCents');
  const commissionCents = calculateBasisPointsAmount(grossCents, input.commissionBasisPoints);
  const refundCents = assertIntegerCents(input.refundCents ?? 0, 'refundCents');
  const adjustmentCents = assertIntegerCents(input.adjustmentCents ?? 0, 'adjustmentCents');

  return {
    grossCents,
    commissionCents,
    refundCents,
    adjustmentCents,
    netPayableCents: Math.max(0, grossCents - commissionCents - refundCents + adjustmentCents)
  };
}

export function calculateRiderSettlement(input: RiderSettlementInput): {
  grossEarningsCents: number;
  bonusCents: number;
  penaltyCents: number;
  netPayableCents: number;
} {
  const grossEarningsCents = input.deliveryEarningsCents.reduce(
    (total, amount) => total + assertIntegerCents(amount, 'deliveryEarningsCents'),
    0
  );
  const bonusCents = assertIntegerCents(input.bonusCents ?? 0, 'bonusCents');
  const penaltyCents = assertIntegerCents(input.penaltyCents ?? 0, 'penaltyCents');

  return {
    grossEarningsCents,
    bonusCents,
    penaltyCents,
    netPayableCents: Math.max(0, grossEarningsCents + bonusCents - penaltyCents)
  };
}
