import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'staging', 'production']);

const booleanFromString = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value === 'true');

const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional()
);

const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )
  .pipe(z.array(z.url()));

const defaultCorsOrigins = [
  'https://user.mealdirect.com',
  'https://vendor.mealdirect.com',
  'https://rider.mealdirect.com',
  'https://admin.mealdirect.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003'
].join(',');

const envSchema = z
  .object({
    NODE_ENV: environmentSchema.default('development'),
    APP_NAME: z.string().min(1).default('Meal Direct API'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    API_PREFIX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-/]*$/)
      .default('v1'),
    DATABASE_URL: z.url(),
    DATABASE_SSL: booleanFromString.default(false),
    DATABASE_SSL_REJECT_UNAUTHORIZED: booleanFromString.default(true),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    SUPABASE_URL: z.url(),
    SUPABASE_JWT_ISSUER: z.url(),
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_JWT_SECRET: optionalSecret,
    CORS_ALLOWED_ORIGINS: csvList.default(defaultCorsOrigins.split(',')),
    LOG_LEVEL: z.enum(['silent', 'debug', 'info', 'warn', 'error']).default('info'),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(10_485_760).default(1_048_576),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    REQUEST_ID_HEADER: z.string().min(1).default('x-request-id'),
    TRACE_ID_HEADER: z.string().min(1).default('x-trace-id'),
    RELEASE_VERSION: z.string().min(1).default('local'),
    COMMIT_SHA: z.string().min(1).default('unknown'),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
    PAYSTACK_SECRET_KEY: optionalSecret,
    PAYSTACK_WEBHOOK_INBOX_MODE: z.enum(['database', 'memory']).default('database'),
    INTERNAL_OPERATIONS_TOKEN: optionalSecret,
    SENTRY_DSN: optionalSecret,
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0)
  })
  .superRefine((env, context) => {
    if ((env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') && !env.DATABASE_SSL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_SSL'],
        message: 'DATABASE_SSL must be true outside development and test'
      });
    }
    if (
      (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') &&
      !env.INTERNAL_OPERATIONS_TOKEN
    ) {
      context.addIssue({
        code: 'custom',
        path: ['INTERNAL_OPERATIONS_TOKEN'],
        message: 'INTERNAL_OPERATIONS_TOKEN must be configured outside development and test'
      });
    }
    if ((env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') && !env.SUPABASE_JWT_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_JWT_SECRET'],
        message: 'SUPABASE_JWT_SECRET must be configured until JWKS verification is introduced'
      });
    }
    if (
      (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') &&
      env.PAYSTACK_WEBHOOK_INBOX_MODE !== 'database'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PAYSTACK_WEBHOOK_INBOX_MODE'],
        message: 'PAYSTACK_WEBHOOK_INBOX_MODE must be database outside development and test'
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYSTACK_BASE_URL !== 'https://api.paystack.co') {
      context.addIssue({
        code: 'custom',
        path: ['PAYSTACK_BASE_URL'],
        message: 'PAYSTACK_BASE_URL must be https://api.paystack.co in production'
      });
    }
  });

export type AppEnvironment = z.infer<typeof envSchema>;

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

export function loadEnvironmentFiles(nodeEnv = process.env.NODE_ENV ?? 'development'): void {
  loadDotenv({ path: '.env', override: false });
  loadDotenv({ path: `.env.${nodeEnv}`, override: false });
}

export function parseEnvironment(raw: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'environment';
      return `${path}: ${issue.message}`;
    });
    throw new EnvironmentValidationError(issues);
  }

  return result.data;
}
