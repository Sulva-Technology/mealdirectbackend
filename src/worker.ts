import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { JsonLogger } from './common/logging/json-logger.service.js';
import { EnvService } from './config/env.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';
import { OutboxProcessor } from './worker/outbox-processor.js';
import { WorkerModule } from './worker/worker.module.js';

async function bootstrapWorker(): Promise<void> {
  loadEnvironmentFiles();
  parseEnvironment();

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);

  const processor = app.get(OutboxProcessor);
  const env = app.get(EnvService);
  const workerId = `worker:${String(process.pid)}`;
  let running = true;

  logger.log(
    { message: 'Meal Direct worker started', workerId, registeredQueues: ['outbox_events'] },
    'Worker'
  );

  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const drained = await processor.drainOnce(workerId);
        if (drained === 0) {
          await new Promise((resolve) => setTimeout(resolve, env.get('WORKER_POLL_INTERVAL_MS')));
        }
      } catch (error) {
        logger.error(
          {
            message: 'Worker tick failed',
            error: error instanceof Error ? error.message : 'unknown'
          },
          undefined,
          'Worker'
        );
        await new Promise((resolve) => setTimeout(resolve, env.get('WORKER_POLL_INTERVAL_MS')));
      }
    }
  };

  const shutdown = async (): Promise<void> => {
    logger.log({ message: 'Meal Direct worker shutting down' }, 'Worker');
    running = false;
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  void tick();
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
