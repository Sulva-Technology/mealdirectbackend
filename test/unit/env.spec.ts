import { describe, expect, it } from 'vitest';

import { EnvironmentValidationError, parseEnvironment } from '../../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  DATABASE_SSL: 'false',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated'
};

describe('environment validation', () => {
  it('parses a valid test environment', () => {
    const env = parseEnvironment(validEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
    expect(env.CORS_ALLOWED_ORIGINS).toContain('https://user.mealdirect.com');
  });

  it('allows managed database poolers to opt out of SSL certificate verification', () => {
    const env = parseEnvironment({
      ...validEnv,
      DATABASE_SSL: 'true',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'false'
    });

    expect(env.DATABASE_SSL).toBe(true);
    expect(env.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(false);
  });

  it('fails clearly when required database configuration is missing', () => {
    const invalidEnv = { ...validEnv, DATABASE_URL: undefined };

    expect(() => parseEnvironment(invalidEnv)).toThrow(EnvironmentValidationError);
    expect(() => parseEnvironment(invalidEnv)).toThrow(/DATABASE_URL/);
  });

  it('requires SSL for staging and production database connections', () => {
    const invalidEnv = {
      ...validEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'false'
    };

    expect(() => parseEnvironment(invalidEnv)).toThrow(/DATABASE_SSL must be true/);
  });
});
