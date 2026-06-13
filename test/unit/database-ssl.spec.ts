import { describe, expect, it } from 'vitest';

import { createPostgresSslConfig } from '../../src/database/database.service.js';

describe('database SSL configuration', () => {
  it('disables SSL for local database connections', () => {
    expect(
      createPostgresSslConfig({
        DATABASE_SSL: false,
        DATABASE_SSL_REJECT_UNAUTHORIZED: true
      })
    ).toBe(false);
  });

  it('uses strict certificate validation by default when SSL is enabled', () => {
    expect(
      createPostgresSslConfig({
        DATABASE_SSL: true,
        DATABASE_SSL_REJECT_UNAUTHORIZED: true
      })
    ).toEqual({ rejectUnauthorized: true });
  });

  it('allows Supabase pooler deployments to relax certificate-chain validation', () => {
    expect(
      createPostgresSslConfig({
        DATABASE_SSL: true,
        DATABASE_SSL_REJECT_UNAUTHORIZED: false
      })
    ).toEqual({ rejectUnauthorized: false });
  });
});
