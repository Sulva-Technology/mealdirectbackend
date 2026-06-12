import { addCents, assertIntegerCents } from './money.js';

export type OrderLinePriceInput = {
  unitPriceCents: number;
  quantity: number;
  spoonCount?: number;
};

export type OrderPricingInput = {
  lines: readonly OrderLinePriceInput[];
  deliveryFeeCents: number;
  serviceFeeCents?: number;
  discountCents?: number;
};

export type OrderPricing = {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  discountCents: number;
  totalCents: number;
  spoonCount: number;
};

function assertPositiveQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive integer.');
  }
  return quantity;
}

function lineTotal(line: OrderLinePriceInput): number {
  return (
    assertIntegerCents(line.unitPriceCents, 'unitPriceCents') *
    assertPositiveQuantity(line.quantity)
  );
}

export function calculateOrderPricing(input: OrderPricingInput): OrderPricing {
  if (input.lines.length === 0) {
    throw new RangeError('At least one order line is required.');
  }

  const subtotalCents = addCents(input.lines.map(lineTotal));
  const deliveryFeeCents = assertIntegerCents(input.deliveryFeeCents, 'deliveryFeeCents');
  const serviceFeeCents = assertIntegerCents(input.serviceFeeCents ?? 0, 'serviceFeeCents');
  const discountCents = assertIntegerCents(input.discountCents ?? 0, 'discountCents');
  const grossCents = subtotalCents + deliveryFeeCents + serviceFeeCents;

  if (discountCents > grossCents) {
    throw new RangeError('discountCents cannot exceed the gross order amount.');
  }

  const spoonCount = input.lines.reduce((total, line) => {
    const requested = line.spoonCount ?? 0;
    if (!Number.isInteger(requested) || requested < 0) {
      throw new RangeError('spoonCount must be a non-negative integer.');
    }
    return total + requested;
  }, 0);

  return {
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    discountCents,
    totalCents: grossCents - discountCents,
    spoonCount
  };
}
