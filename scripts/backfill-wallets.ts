import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';

import { AppModule } from '../src/app.module.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';
import { DatabaseService } from '../src/database/database.service.js';
import { JsonLogger } from '../src/common/logging/json-logger.service.js';

/**
 * Cutover backfill. Provisions a wallet for every existing customer that has none, which also
 * queues one wallet.dva_requested event each; the outbox worker then creates the Paystack
 * customer and dedicated account at its own pace (and does nothing while WALLET_DVA_ENABLED
 * is off). Safe to re-run: ensure_customer_wallet is idempotent and emits at most one event
 * per wallet.
 *
 * Usage: pnpm backfill:wallets [batchSize]
 */
async function backfillWallets(batchSize: number): Promise<void> {
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
    let provisioned = 0;

    for (;;) {
      // Customers are profiles with no vendor and no rider record — the same shape the
      // admin user list uses to classify a user (admin.repository.ts).
      const result = await sql<{ provisioned: number }>`
        with candidates as (
          select p.id
          from public.profiles p
          left join public.wallets w on w.user_id = p.id
          where w.id is null
            and not exists (select 1 from public.vendor_users vu where vu.user_id = p.id)
            and not exists (select 1 from public.riders r where r.user_id = p.id)
          order by p.created_at
          limit ${batchSize}
        )
        select count(public.ensure_customer_wallet(c.id))::integer as "provisioned"
        from candidates c
      `.execute(database.db);

      const batch = result.rows[0]?.provisioned ?? 0;
      provisioned += batch;
      logger.log({ message: 'Wallet backfill batch complete', batch, provisioned }, 'Backfill');

      if (batch < batchSize) break;
    }

    logger.log({ message: 'Wallet backfill complete', provisioned }, 'Backfill');
  } finally {
    await app.close();
  }
}

const requestedBatchSize = Number.parseInt(process.argv[2] ?? '500', 10);
backfillWallets(Number.isFinite(requestedBatchSize) ? requestedBatchSize : 500).catch(
  (error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        context: 'Backfill',
        message: error instanceof Error ? error.message : 'Unknown backfill failure'
      })
    );
    process.exit(1);
  }
);
