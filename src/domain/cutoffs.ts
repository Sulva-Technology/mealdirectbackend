export type CutoffDecision = {
  allowed: boolean;
  cutoffAt: Date;
  now: Date;
  reason?: 'ORDERING_CUTOFF_PASSED';
};

export function calculateOrderingCutoff(slotStartsAt: Date, cutoffMinutesBeforeSlot: number): Date {
  if (!Number.isInteger(cutoffMinutesBeforeSlot) || cutoffMinutesBeforeSlot < 0) {
    throw new RangeError('cutoffMinutesBeforeSlot must be a non-negative integer.');
  }

  return new Date(slotStartsAt.getTime() - cutoffMinutesBeforeSlot * 60_000);
}

export function decideOrderingCutoff(
  now: Date,
  slotStartsAt: Date,
  cutoffMinutesBeforeSlot: number
): CutoffDecision {
  const cutoffAt = calculateOrderingCutoff(slotStartsAt, cutoffMinutesBeforeSlot);

  if (now.getTime() >= cutoffAt.getTime()) {
    return {
      allowed: false,
      cutoffAt,
      now,
      reason: 'ORDERING_CUTOFF_PASSED'
    };
  }

  return {
    allowed: true,
    cutoffAt,
    now
  };
}
