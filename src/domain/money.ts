export type MoneyCents = number;

export function assertIntegerCents(value: number, label: string): MoneyCents {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer amount in cents.`);
  }
  return value;
}

export function addCents(values: readonly number[]): MoneyCents {
  return values.reduce((total, value) => total + assertIntegerCents(value, 'amount'), 0);
}

export function calculateBasisPointsAmount(amountCents: number, basisPoints: number): MoneyCents {
  assertIntegerCents(amountCents, 'amountCents');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError('basisPoints must be an integer from 0 to 10000.');
  }
  return Math.round((amountCents * basisPoints) / 10_000);
}
