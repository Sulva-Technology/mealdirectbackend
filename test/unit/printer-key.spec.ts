import { describe, expect, it } from 'vitest';

import {
  cloudPrntServerUrl,
  generatePrinterKey,
  hashPrinterKey,
  isWellFormedPrinterKey,
  normalizeMacAddress
} from '../../src/modules/printing/printer-key.js';

describe('printer keys', () => {
  it('generates unique well-formed keys', () => {
    const a = generatePrinterKey();
    const b = generatePrinterKey();
    expect(a).not.toBe(b);
    expect(isWellFormedPrinterKey(a)).toBe(true);
  });

  it('rejects malformed keys', () => {
    expect(isWellFormedPrinterKey('short')).toBe(false);
    expect(isWellFormedPrinterKey(`${'a'.repeat(42)}/`)).toBe(false);
  });

  it('hashes deterministically to 64 hex chars', () => {
    expect(hashPrinterKey('k')).toBe(hashPrinterKey('k'));
    expect(hashPrinterKey('k')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds the CloudPRNT server URL', () => {
    expect(cloudPrntServerUrl('https://api.example.com/', 'v1', 'KEY')).toBe(
      'https://api.example.com/v1/printers/cloudprnt/KEY'
    );
  });
});

describe('normalizeMacAddress', () => {
  it.each([
    ['00:11:62:AA:BB:CC', '00:11:62:aa:bb:cc'],
    ['00-11-62-aa-bb-cc', '00:11:62:aa:bb:cc'],
    ['001162AABBCC', '00:11:62:aa:bb:cc'],
    ['0011.62aa.bbcc', '00:11:62:aa:bb:cc']
  ])('normalises %s', (input, expected) => {
    expect(normalizeMacAddress(input)).toBe(expected);
  });

  it.each(['00:11:62:AA:BB', '00:11:62:AA:BB:CC:DD', 'zz:11:62:aa:bb:cc', ''])(
    'rejects %s',
    (input) => {
      expect(normalizeMacAddress(input)).toBeUndefined();
    }
  );
});
