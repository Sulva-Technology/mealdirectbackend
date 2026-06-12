import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';

async function bootstrapWorker(): Promise<void> {
  loadEnvironmentFiles();
  parseEnvironment();

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);

  logger.log(
    {
      message: 'Meal Direct worker context started',
      registeredQueues: ['outbox_events']
    },
    'Worker'
  );

  const shutdown = async (): Promise<void> => {
    logger.log({ message: 'Meal Direct worker shutting down' }, 'Worker');
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

bootstrapWorker().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        context: 'Environment',
        message: error.message,
        issues: error.issues
      })
    );
    process.exit(1);
  }

  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      context: 'Worker',
      message: error instanceof Error ? error.message : 'Unknown worker failure'
    })
  );
  process.exit(1);
});
