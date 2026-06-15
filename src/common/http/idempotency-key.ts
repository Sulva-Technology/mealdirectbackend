export const idempotencyKeyHeader = 'Idempotency-Key';
export const idempotencyKeyHeaderLower = 'idempotency-key';
export const maxIdempotencyKeyLength = 128;

export function normalizeIdempotencyKey(value: string | string[] | undefined): string {
  const key = Array.isArray(value) ? value[0] : value;
  if (key === undefined || key.trim().length === 0) {
    throw new Error('Idempotency-Key header is required.');
  }

  const normalized = key.trim();
  if (normalized.length > maxIdempotencyKeyLength) {
    throw new Error('Idempotency-Key header must be 128 characters or less.');
  }

  return normalized;
}
