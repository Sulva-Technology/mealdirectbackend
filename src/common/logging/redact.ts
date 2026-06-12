const sensitiveKeyFragments = [
  'authorization',
  'cookie',
  'paystack',
  'supabase',
  'secret',
  'token',
  'password',
  'signature',
  'account_number',
  'accountNumber',
  'bank_account'
];

export function redactValue(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase();
  if (sensitiveKeyFragments.some((fragment) => normalized.includes(fragment.toLowerCase()))) {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry));
  }

  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>);
  }

  return value;
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, redactValue(key, value)])
  );
}

export function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry));
  }

  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>);
  }

  return value;
}
