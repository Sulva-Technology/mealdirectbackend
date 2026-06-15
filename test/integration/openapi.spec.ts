import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { createOpenApiDocument } from '../../src/openapi.js';

describe('OpenAPI contract foundation', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('documents health endpoints and auth schemes', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/health/live']).toBeDefined();
    expect(document.paths['/v1/health/ready']).toBeDefined();
    expect(document.components?.securitySchemes?.supabaseAuth).toBeDefined();
    expect(document.components?.securitySchemes?.idempotencyKey).toBeDefined();
  });

  it('registers shared API contract schemas', () => {
    const document = createOpenApiDocument(app);

    expect(document.components?.schemas?.CursorPaginationQueryDto).toBeDefined();
    expect(document.components?.schemas?.CursorPaginationMetaDto).toBeDefined();
    expect(document.components?.schemas?.MoneyDto).toBeDefined();
    expect(document.components?.schemas?.ErrorEnvelopeDto).toBeDefined();
    expect(document.components?.schemas?.ListEnvelopeDto).toBeDefined();
  });

  it('documents current-user profile and onboarding endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/me']).toBeDefined();
    expect(document.paths['/v1/me']?.get).toBeDefined();
    expect(document.paths['/v1/me']?.patch).toBeDefined();
    expect(document.paths['/v1/me/campuses']?.get).toBeDefined();
    expect(document.paths['/v1/me/complete-onboarding']?.post).toBeDefined();
    expect(document.paths['/v1/me/default-location']?.put).toBeDefined();
  });
});
