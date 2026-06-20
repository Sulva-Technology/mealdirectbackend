import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ClassSerializerInterceptor, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import * as Sentry from '@sentry/node';

import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import {
  NoopErrorReporter,
  SentryErrorReporter,
  type ErrorReporter
} from './common/observability/error-reporter.js';
import { redactRecord } from './common/logging/redact.js';
import { MetricsService } from './common/observability/metrics.service.js';
import { attachRequestId, extractTraceId } from './common/request/request-id.js';
import { createValidationPipe } from './common/validation.js';
import { EnvService } from './config/env.service.js';
import type { AppEnvironment } from './config/env.js';
import { mountOpenApi } from './openapi.js';

export type CreateAppOptions = {
  env?: AppEnvironment;
  enableOpenApi?: boolean;
};

function createErrorReporter(config: AppEnvironment): ErrorReporter {
  if (config.SENTRY_DSN === undefined) {
    return new NoopErrorReporter();
  }
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    release: config.RELEASE_VERSION
  });
  return new SentryErrorReporter(Sentry);
}

function configureGlobals(app: INestApplication, reporter: ErrorReporter): void {
  const logger = app.get(JsonLogger);
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter(logger, reporter));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
}

function configureRawJsonParser(fastify: FastifyInstance): void {
  if (fastify.hasContentTypeParser('application/json')) {
    fastify.removeContentTypeParser('application/json');
  }

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const rawBody = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = rawBody;

    if (rawBody.trim().length === 0) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(rawBody) as unknown);
    } catch (error) {
      done(error instanceof Error ? error : new Error('Invalid JSON body'), undefined);
    }
  });
}

export async function createApp(options: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  const env = options.env;
  const adapter = new FastifyAdapter({
    bodyLimit: env?.BODY_LIMIT_BYTES ?? 1_048_576,
    trustProxy: true,
    logger: false
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    abortOnError: false,
    bodyParser: false,
    bufferLogs: true,
    logger: false
  });

  const envService = app.get(EnvService);
  const config = envService.all;

  await app.register(helmet, {
    global: true
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || config.CORS_ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      config.REQUEST_ID_HEADER,
      config.TRACE_ID_HEADER
    ],
    credentials: true
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS
  });

  const fastify = app.getHttpAdapter().getInstance();
  configureRawJsonParser(fastify);

  fastify.addHook('onRequest', (request, reply, done) => {
    attachRequestId(request, reply, config.REQUEST_ID_HEADER);
    request.traceId = extractTraceId(request, config.TRACE_ID_HEADER);
    request.startedAtMs = performance.now();
    reply.header(config.TRACE_ID_HEADER, request.traceId);
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const logger = app.get(JsonLogger);
    const metrics = app.get(MetricsService);
    const durationMs = Math.round(performance.now() - (request.startedAtMs ?? performance.now()));
    const route = request.routeOptions.url ?? request.url;
    metrics.recordRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs
    });

    logger.log(
      {
        requestId: request.requestId,
        traceId: request.traceId,
        method: request.method,
        route,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs,
        headers: redactRecord(request.headers)
      },
      'HttpRequest'
    );
    done();
  });

  app.setGlobalPrefix(config.API_PREFIX);
  configureGlobals(app, createErrorReporter(config));

  if (options.enableOpenApi ?? true) {
    mountOpenApi(app);
  }

  app.enableShutdownHooks();
  return app;
}
