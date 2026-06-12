import { assertIntegerCents } from './money.js';

export type RefundInput = {
  capturedAmountCents: number;
  itemRefundCents: number;
  deliveryRefundCents?: number;
  serviceFeeRefundCents?: number;
  penaltyCents?: number;
};

export function calculateRefund(input: RefundInput): {
  requestedRefundCents: number;
  penaltyCents: number;
  refundableCents: number;
} {
  const capturedAmountCents = assertIntegerCents(input.capturedAmountCents, 'capturedAmountCents');
  const itemRefundCents = assertIntegerCents(input.itemRefundCents, 'itemRefundCents');
  const deliveryRefundCents = assertIntegerCents(
    input.deliveryRefundCents ?? 0,
    'deliveryRefundCents'
  );
  const serviceFeeRefundCents = assertIntegerCents(
    input.serviceFeeRefundCents ?? 0,
    'serviceFeeRefundCents'
  );
  const penaltyCents = assertIntegerCents(input.penaltyCents ?? 0, 'penaltyCents');
  const requestedRefundCents = itemRefundCents + deliveryRefundCents + serviceFeeRefundCents;

  return {
    requestedRefundCents,
    penaltyCents,
    refundableCents: Math.max(0, Math.min(capturedAmountCents, requestedRefundCents) - penaltyCents)
  };
}
