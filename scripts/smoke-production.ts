import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import {
  compareFrontendContracts,
  extractOpenApiMethodMap
} from '../src/readiness/frontend-contract.js';

type OpenApiDocument = {
  paths?: Record<string, unknown>;
};

function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required for production smoke checks.`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
    return undefined;
  }
  return trimmed;
}

function apiUrl(path: string): URL {
  return new URL(path, requireEnv('SMOKE_BASE_URL'));
}

async function assertOk(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new Error(`${path} returned ${String(response.status)}`);
  }
  return response;
}

async function assertStatus(
  path: string,
  expectedStatus: number,
  init?: RequestInit
): Promise<void> {
  const response = await fetch(apiUrl(path), init);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} returned ${String(response.status)}; expected ${String(expectedStatus)}`
    );
  }
}

async function assertCorsAllowed(origin: string): Promise<void> {
  const response = await fetch(apiUrl('/v1/health/live'), {
    headers: { origin }
  });
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (allowOrigin !== origin) {
    throw new Error(`CORS origin ${origin} was not allowed; received ${allowOrigin ?? '<none>'}`);
  }
}

async function assertCorsDisallowedDoesNot500(): Promise<void> {
  const response = await fetch(apiUrl('/v1/health/live'), {
    headers: { origin: 'https://not-meal-direct.invalid' }
  });
  if (response.status >= 500) {
    throw new Error(`Disallowed CORS probe returned ${String(response.status)}`);
  }
}

function parseOpenApi(value: unknown, label: string): OpenApiDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} OpenAPI document is malformed.`);
  }
  const document = value as OpenApiDocument;
  if (document.paths === undefined) {
    throw new Error(`${label} OpenAPI document is missing paths.`);
  }
  return document;
}

async function assertRemoteOpenApiMatchesLocal(): Promise<void> {
  const local = parseOpenApi(
    JSON.parse(await readFile(resolve('docs/openapi.json'), 'utf8')),
    'local'
  );
  const remote = parseOpenApi(await (await assertOk('/docs/openapi.json')).json(), 'remote');

  const localMethodMap = extractOpenApiMethodMap(local.paths ?? {});
  const remoteMethodMap = extractOpenApiMethodMap(remote.paths ?? {});
  const expectedEndpoints = Object.entries(localMethodMap).flatMap(([path, methods]) =>
    methods.map((method) => `${method} ${path}`)
  );
  const comparison = compareFrontendContracts(expectedEndpoints, remoteMethodMap);

  if (comparison.missing.length > 0) {
    throw new Error(
      `Remote OpenAPI is missing ${String(comparison.missing.length)} local endpoint shapes:\n${comparison.missing.join('\n')}`
    );
  }
}

loadDotenv({ path: '.env.production', override: false });

process.env.SMOKE_BASE_URL =
  optionalEnv('SMOKE_BASE_URL') ??
  optionalEnv('PRODUCTION_API_BASE_URL') ??
  optionalEnv('API_BASE_URL') ??
  'https://mealdirectbackend.onrender.com';

if (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== 'production') {
  throw new Error('smoke:production must run with NODE_ENV unset or production.');
}

const expectedOrigins = (
  process.env.SMOKE_FRONTEND_ORIGINS ??
  process.env.CORS_ALLOWED_ORIGINS ??
  ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

await assertOk('/v1/health/live');
await assertOk('/v1/health/ready');
await assertOk('/docs');
await assertRemoteOpenApiMatchesLocal();

await assertStatus('/v1/me', 401);
await assertStatus('/v1/vendor/profile', 401);
await assertStatus('/v1/rider/profile', 401);
await assertStatus('/v1/admin/session', 401);
await assertStatus('/v1/payments/webhooks/paystack', 401, {
  body: '{}',
  headers: { 'content-type': 'application/json' },
  method: 'POST'
});

await assertCorsDisallowedDoesNot500();
for (const origin of expectedOrigins) {
  await assertCorsAllowed(origin);
}

await assertOk('/v1/operations/status', {
  headers: {
    authorization: `Bearer ${requireEnv('INTERNAL_OPERATIONS_TOKEN')}`
  }
});

console.log(
  JSON.stringify({
    status: 'ok',
    baseUrl: requireEnv('SMOKE_BASE_URL'),
    checkedOrigins: expectedOrigins.length
  })
);
