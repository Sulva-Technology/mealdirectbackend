export type SpoonLimitDecision = {
  allowed: boolean;
  requestedSpoons: number;
  maxSpoons: number;
  reason?: 'SPOON_LIMIT_EXCEEDED';
};

export function decideSpoonLimit(requestedSpoons: number, maxSpoons: number): SpoonLimitDecision {
  if (!Number.isInteger(requestedSpoons) || requestedSpoons < 0) {
    throw new RangeError('requestedSpoons must be a non-negative integer.');
  }
  if (!Number.isInteger(maxSpoons) || maxSpoons < 0) {
    throw new RangeError('maxSpoons must be a non-negative integer.');
  }

  if (requestedSpoons > maxSpoons) {
    return {
      allowed: false,
      requestedSpoons,
      maxSpoons,
      reason: 'SPOON_LIMIT_EXCEEDED'
    };
  }

  return {
    allowed: true,
    requestedSpoons,
    maxSpoons
  };
}
