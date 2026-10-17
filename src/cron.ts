import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';

import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import { DatabaseService } from './database/database.service.js';
import { DvaTopupSweepService } from './modules/payments/dva-topup-sweep.service.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { PayoutService } from './modules/settlements/payout.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';

const cronJobs = [
  'release-expired-reservations',
  'close-batches-at-cutoff',
  'generate-inventory-horizon',
  'reconcile-pending-payments',
  'reconcile-wallet-balances',
  'run-payouts',
  'reconcile-payout-transfers',
  'sweep-dva-topups'
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
    if (job === 'reconcile-pending-payments') {
      const result = await app.get(PaymentsService).reconcilePendingPayments();
      logger.log({ message: 'Reconciled pending payments', job, ...result }, 'Cron');
    }
    if (job === 'reconcile-wallet-balances') {
      const result = await sql<{ detected: number }>`
        select public.detect_wallet_balance_drift() as "detected"
      `.execute(database.db);
      logger.log(
        { message: 'Reconciled wallet balances', job, detected: result.rows[0]?.detected ?? 0 },
        'Cron'
      );
    }
    if (job === 'run-payouts') {
      const result = await app.get(PayoutService).runPayouts();
      logger.log({ message: 'Ran payouts', job, ...result }, 'Cron');
    }
    if (job === 'sweep-dva-topups') {
      const result = await app.get(DvaTopupSweepService).sweep();
      logger.log({ message: 'Swept dedicated-account top-ups', job, ...result }, 'Cron');
    }
    if (job === 'reconcile-payout-transfers') {
      const result = await app.get(PayoutService).reconcilePendingPayouts();
      logger.log({ message: 'Reconciled payout transfers', job, ...result }, 'Cron');
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
