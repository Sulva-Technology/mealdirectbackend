import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, URL-safe. Shown to the vendor once as part of the printer server URL. */
export function generatePrinterKey(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPrinterKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Keys are 43 base64url chars; anything else is rejected before touching the database. */
export function isWellFormedPrinterKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(key);
}

/**
 * Normalise a MAC to lower-case colon form. Accepts "00:11:62:AA:BB:CC", "00-11-62-aa-bb-cc"
 * and "001162AABBCC". Returns undefined for anything that is not 12 hex digits.
 */
export function normalizeMacAddress(value: string): string | undefined {
  const hex = value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12 || value.replace(/[\s:.-]/g, '').length !== 12) return undefined;
  return hex.match(/.{2}/g)?.join(':');
}

export function cloudPrntServerUrl(baseUrl: string, apiPrefix: string, key: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const prefix = apiPrefix.replace(/^\/+|\/+$/g, '');
  return `${base}/${prefix}/printers/cloudprnt/${key}`;
}
