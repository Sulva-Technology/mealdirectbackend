import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AppEnvironment } from '../../src/config/env.js';
import { createEmailTransport } from '../../src/worker/transports.js';

const smtpSendMail = vi.fn();
const resendEmailsSend = vi.fn();

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: smtpSendMail
  }))
}));

function MockResend(this: { emails: { send: typeof resendEmailsSend } }, _apiKey: string) {
  this.emails = { send: resendEmailsSend };
}

vi.mock('resend', () => ({
  Resend: MockResend
}));

function env(overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  return {
    NODE_ENV: 'test',
    APP_NAME: 'Meal Direct API',
    HOST: '0.0.0.0',
    PORT: 4000,
    API_PREFIX: 'v1',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    DATABASE_SSL: false,
    DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    DATABASE_SSL_CA: undefined,
    DATABASE_POOL_MAX: 10,
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_JWT_SECRET: undefined,
    SUPABASE_JWKS_URL: undefined,
    MEDIA_SIGNED_URL_TTL_SECONDS: 3600,
    CORS_ALLOWED_ORIGINS: [],
    APP_URL_CUSTOMER: 'https://user.example.com',
    APP_URL_VENDOR: 'https://vendor.example.com',
    APP_URL_RIDER: 'https://rider.example.com',
    APP_URL_ADMIN: 'https://admin.example.com',
    APP_URL_FLEET: 'https://admin.example.com',
    LOG_LEVEL: 'info',
    BODY_LIMIT_BYTES: 1048576,
    RATE_LIMIT_MAX: 120,
    RATE_LIMIT_WINDOW_MS: 60000,
    AUTH_RATE_LIMIT_MAX: 10,
    AUTH_RATE_LIMIT_WINDOW_MS: 60000,
    ENABLE_API_DOCS: true,
    AUTH_ALLOW_USER_METADATA_ROLE_FALLBACK: false,
    REQUEST_ID_HEADER: 'x-request-id',
    TRACE_ID_HEADER: 'x-trace-id',
    RELEASE_VERSION: 'test',
    COMMIT_SHA: 'test',
    WORKER_POLL_INTERVAL_MS: 2000,
    WORKER_BATCH_SIZE: 10,
    WORKER_MAX_ATTEMPTS: 5,
    RESERVATION_TTL_SECONDS: 900,
    DELIVERY_FEE_KOBO: 15000,
    SERVICE_FEE_KOBO: 20000,
    MAX_ORDER_TOTAL_KOBO: 249000,
    LARGE_ORDER_SURCHARGE_BPS: 150,
    LARGE_ORDER_SURCHARGE_FLAT_KOBO: 10000,
    PAYSTACK_BASE_URL: 'https://api.paystack.co',
    PAYSTACK_SECRET_KEY: undefined,
    PAYSTACK_WEBHOOK_INBOX_MODE: 'memory',
    INTERNAL_OPERATIONS_TOKEN: undefined,
    SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: undefined,
    SENTRY_TRACES_SAMPLE_RATE: 0,
    RESEND_API_KEY: undefined,
    EMAIL_FROM: 'Meal Direct <no-reply@mealdirectly.com>',
    MAIL_TRANSPORT: 'resend',
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_SECURE: false,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: undefined,
    FCM_PROJECT_ID: undefined,
    FCM_CLIENT_EMAIL: undefined,
    FCM_PRIVATE_KEY: undefined,
    PAYOUTS_ENABLED: false,
    WALLET_DVA_ENABLED: false,
    WALLET_DVA_PROVIDER: 'test-bank',
    ...overrides
  } as AppEnvironment;
}

beforeEach(() => {
  vi.clearAllMocks();
  smtpSendMail.mockResolvedValue({ messageId: '<smtp-1>' });
  resendEmailsSend.mockResolvedValue({ data: { id: 'r1' }, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEmailTransport', () => {
  it('uses Resend by default when RESEND_API_KEY set', async () => {
    const transport = createEmailTransport(env({ RESEND_API_KEY: 're_xxx' }));
    await transport.send({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(resendEmailsSend).toHaveBeenCalledWith({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(smtpSendMail).not.toHaveBeenCalled();
  });

  it('falls back to noop when resend key missing (default mode)', async () => {
    const transport = createEmailTransport(env({ RESEND_API_KEY: undefined }));
    await transport.send({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(resendEmailsSend).not.toHaveBeenCalled();
  });

  it('uses SMTP when MAIL_TRANSPORT=smtp', async () => {
    const transport = createEmailTransport(
      env({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 587, SMTP_SECURE: false })
    );
    await transport.send({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(smtpSendMail).toHaveBeenCalledWith({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(resendEmailsSend).not.toHaveBeenCalled();
  });

  it('SMTP uses SMTP_FROM override when set', async () => {
    const transport = createEmailTransport(
      env({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_FROM: 'Meal Direct <noreply@example.com>'
      })
    );
    await transport.send({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(smtpSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Meal Direct <noreply@example.com>' })
    );
  });

  it('SMTP falls back to noop when host missing', async () => {
    const transport = createEmailTransport(env({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: undefined }));
    await transport.send({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body'
    });
    expect(smtpSendMail).not.toHaveBeenCalled();
    expect(resendEmailsSend).not.toHaveBeenCalled();
  });

  it('Resend throws on send error', async () => {
    resendEmailsSend.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    const transport = createEmailTransport(env({ RESEND_API_KEY: 're_xxx' }));
    await expect(
      transport.send({ from: 'a@b.c', to: 'd@e.f', subject: 'Hi', text: 'body' })
    ).rejects.toThrow('Resend send failed: domain not verified');
  });
});
