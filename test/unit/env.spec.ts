import { describe, expect, it } from 'vitest';

import { EnvironmentValidationError, parseEnvironment } from '../../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  DATABASE_SSL: 'false',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_ANON_KEY: 'test-anon-key'
};

describe('environment validation', () => {
  it('parses a valid test environment', () => {
    const env = parseEnvironment(validEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
    expect(env.CORS_ALLOWED_ORIGINS).toContain('https://user.mealdirectly.com');
    expect(env.PAYSTACK_BASE_URL).toBe('https://api.paystack.co');
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

  it('allows Paystack base URL override outside production for fake provider tests', () => {
    const env = parseEnvironment({
      ...validEnv,
      PAYSTACK_BASE_URL: 'http://127.0.0.1:59999'
    });

    expect(env.PAYSTACK_BASE_URL).toBe('http://127.0.0.1:59999');
  });

  it('requires the official Paystack base URL in production', () => {
    const invalidEnv = {
      ...validEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'true',
      INTERNAL_OPERATIONS_TOKEN: 'prod-operations-token',
      PAYSTACK_BASE_URL: 'http://127.0.0.1:59999',
      PAYSTACK_SECRET_KEY: 'prod-paystack-secret',
      SUPABASE_JWT_SECRET: 'prod-jwt-secret'
    };

    expect(() => parseEnvironment(invalidEnv)).toThrow(/PAYSTACK_BASE_URL/);
  });

  it('requires Firebase Cloud Messaging credentials in staging and production', () => {
    const invalidEnv = {
      ...validEnv,
      NODE_ENV: 'staging',
      DATABASE_SSL: 'true',
      INTERNAL_OPERATIONS_TOKEN: 'staging-operations-token',
      SUPABASE_JWT_SECRET: 'staging-jwt-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role-key',
      RESEND_API_KEY: 'staging-resend-key'
    };

    expect(() => parseEnvironment(invalidEnv)).toThrow(/FCM_PROJECT_ID/);
    expect(() => parseEnvironment(invalidEnv)).toThrow(/FCM_CLIENT_EMAIL/);
    expect(() => parseEnvironment(invalidEnv)).toThrow(/FCM_PRIVATE_KEY/);
  });
});
