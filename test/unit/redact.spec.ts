import { describe, expect, it } from 'vitest';

import { redactRecord } from '../../src/common/logging/redact.js';

describe('log redaction', () => {
  it('redacts authorization, cookies, provider secrets and account details recursively', () => {
    const redacted = redactRecord({
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      nested: {
        paystackSecret: 'sk_test_secret',
        accountNumber: '1234567890',
        harmless: 'visible'
      }
    });

    expect(redacted).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      nested: {
        paystackSecret: '[REDACTED]',
        accountNumber: '[REDACTED]',
        harmless: 'visible'
      }
    });
  });
});
