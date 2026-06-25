import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';

import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import { DatabaseService } from './database/database.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';

const cronJobs = [
  'release-expired-reservations',
  'close-batches-at-cutoff',
  'generate-inventory-horizon'
] as const;
type CronJob = (typeof cronJobs)[number];

function parseCronJob(rawJob: string | undefined): CronJob {
  if (rawJob !== undefined && cronJobs.includes(rawJob as CronJob)) {
    return rawJob as CronJob;
  }
  throw new Error(
    `Unknown cron job "${rawJob ?? '<missing>'}". Expected one of: ${cronJobs.join(', ')}.`
  );
}

async function runCronJob(job: CronJob): Promise<void> {
  loadEnvironmentFiles();
  parseEnvironment();

  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    bufferLogs: true,
    logger: false
  });

  const logger = app.get(JsonLogger);
  const database = app.get(DatabaseService);
  app.useLogger(logger);

  try {
    if (job === 'release-expired-reservations') {
      await sql`select public.release_expired_reservations()`.execute(database.db);
    }
    if (job === 'close-batches-at-cutoff') {
      await sql`select public.close_batches_at_cutoff()`.execute(database.db);
    }
    if (job === 'generate-inventory-horizon') {
      await sql`select public.generate_inventory_horizon(7)`.execute(database.db);
    }

    logger.log({ message: 'Cron job completed', job }, 'Cron');
  } finally {
    await app.close();
  }
}

runCronJob(parseCronJob(process.argv[2])).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown cron failure';
  const issues = error instanceof EnvironmentValidationError ? error.issues : undefined;
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      context: 'Cron',
      message,
      ...(issues === undefined ? {} : { issues })
    })
  );
  process.exit(1);
});
