// Paystack's published Nigerian local-card pricing: 1.5% + ₦100, the ₦100 waived below
// ₦2,500, the whole fee capped at ₦2,000. Used to gross up a wallet top-up so the customer
// pays the processing fee and the wallet is credited exactly the amount they asked for.
const FEE_RATE = 0.015;
const FLAT_FEE_KOBO = 10_000;
const FLAT_FEE_WAIVED_BELOW_KOBO = 250_000;
const FEE_CAP_KOBO = 200_000;

export type TopupCharge = {
  /** What lands in the wallet. */
  creditKobo: number;
  /** Paystack processing fee passed on to the customer. */
  feeKobo: number;
  /** What the customer is charged at checkout: credit + fee. */
  chargeKobo: number;
};

/** Paystack's "pass charges to customer" formula, in whole kobo. */
export function calculateTopupCharge(creditKobo: number, passFees = true): TopupCharge {
  if (!passFees) {
    return { creditKobo, feeKobo: 0, chargeKobo: creditKobo };
  }

  const flatKobo = creditKobo < FLAT_FEE_WAIVED_BELOW_KOBO ? 0 : FLAT_FEE_KOBO;
  const applicableFeeKobo = creditKobo * FEE_RATE + flatKobo;
  const chargeKobo =
    applicableFeeKobo > FEE_CAP_KOBO
      ? creditKobo + FEE_CAP_KOBO
      : // +1 kobo absorbs Paystack's own rounding so the net never falls a kobo short.
        Math.ceil((creditKobo + flatKobo) / (1 - FEE_RATE)) + 1;

  return { creditKobo, feeKobo: chargeKobo - creditKobo, chargeKobo };
}

export type DepositSplit = {
  /** MealDirect deposit fee kept from the deposit. */
  depositFeeKobo: number;
  /** What lands in the wallet: deposit minus the deposit fee. */
  creditKobo: number;
};

/**
 * MealDirect's own deposit fee (basis points; 100 = 1%), deducted from every wallet deposit —
 * card checkout and dedicated-account transfer alike. Rounded to the nearest kobo and never
 * allowed to consume the whole deposit.
 */
export function splitDeposit(depositKobo: number, feeBps: number): DepositSplit {
  if (feeBps <= 0 || depositKobo <= 1) {
    return { depositFeeKobo: 0, creditKobo: depositKobo };
  }
  const depositFeeKobo = Math.min(Math.round((depositKobo * feeBps) / 10_000), depositKobo - 1);
  return { depositFeeKobo, creditKobo: depositKobo - depositFeeKobo };
}

/**
 * What a successful top-up credits. A checkout top-up carries its own credit amount in
 * metadata (deposit fee already taken, Paystack fee excluded) — depositFeeKobo is null because
 * nothing is taken here. A dedicated-account transfer has no metadata, so the deposit fee is
 * taken from the amount received. Never credits more than was actually paid.
 */
export function resolveTopupCredit(
  input: { amountKobo: number; creditKobo?: number },
  feeBps: number
): { creditKobo: number; depositFeeKobo: number | null } {
  if (input.creditKobo !== undefined && input.creditKobo <= input.amountKobo) {
    return { creditKobo: input.creditKobo, depositFeeKobo: null };
  }
  return splitDeposit(input.amountKobo, feeBps);
}
