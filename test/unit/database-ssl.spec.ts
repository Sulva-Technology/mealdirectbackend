import { describe, expect, it } from 'vitest';

import {
  createPostgresPoolConfig,
  createPostgresSslConfig
} from '../../src/database/database.service.js';

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

  it('relaxes certificate-chain validation when configured even if the URL has sslmode', () => {
    expect(
      createPostgresPoolConfig({
        DATABASE_URL:
          'postgresql://postgres:postgres@example.supabase.com:5432/postgres?sslmode=require',
        DATABASE_POOL_MAX: 10,
        DATABASE_SSL: true,
        DATABASE_SSL_REJECT_UNAUTHORIZED: false
      })
    ).toEqual({
      connectionString:
        'postgresql://postgres:postgres@example.supabase.com:5432/postgres?sslmode=require',
      max: 10,
      ssl: {
        rejectUnauthorized: false
      }
    });
  });

  it('lets node-postgres honor sslmode when strict certificate validation is enabled', () => {
    expect(
      createPostgresPoolConfig({
        DATABASE_URL:
          'postgresql://postgres:postgres@example.supabase.com:5432/postgres?sslmode=verify-full',
        DATABASE_POOL_MAX: 10,
        DATABASE_SSL: true,
        DATABASE_SSL_REJECT_UNAUTHORIZED: true
      })
    ).toEqual({
      connectionString:
        'postgresql://postgres:postgres@example.supabase.com:5432/postgres?sslmode=verify-full',
      max: 10
    });
  });
});
