import { SwaggerModule, DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

import {
  CursorPaginationMetaDto,
  CursorPaginationQueryDto,
  DateRangeQueryDto,
  ErrorBodyDto,
  ErrorEnvelopeDto,
  ListEnvelopeDto,
  MoneyDto,
  SortQueryDto,
  StatusQueryDto,
  SuccessEnvelopeDto,
  UuidParamDto
} from './common/dto/api-contract.dto.js';
import { EnvService } from './config/env.service.js';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const env = app.get(EnvService);
  const config = new DocumentBuilder()
    .setTitle('Meal Direct API')
    .setDescription('Stable REST API for Meal Direct web and future mobile clients.')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Supabase JWT',
        description: 'Supabase Auth access token.'
      },
      'supabaseAuth'
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'Idempotency-Key',
        in: 'header',
        description: 'Required for important mutations such as order creation and payments.'
      },
      'idempotencyKey'
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: env.get('REQUEST_ID_HEADER'),
        in: 'header',
        description: 'Optional caller-provided request ID. The API echoes or generates one.'
      },
      'requestId'
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description:
          'Internal operations token. Temporary until Super Admin JWT/RBAC is implemented.'
      },
      'operationsToken'
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    extraModels: [
      CursorPaginationMetaDto,
      CursorPaginationQueryDto,
      DateRangeQueryDto,
      ErrorBodyDto,
      ErrorEnvelopeDto,
      ListEnvelopeDto,
      MoneyDto,
      SortQueryDto,
      StatusQueryDto,
      SuccessEnvelopeDto,
      UuidParamDto
    ]
  });
}

export function mountOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json'
  });
}
