import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';
import { JsonLogger } from '../src/common/logging/json-logger.service.js';
import type { PaystackWebhookEvent } from '../src/domain/payments.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { PaystackWebhookService } from '../src/modules/payments/paystack-webhook.service.js';

/**
 * Credits a dedicated-account transfer whose webhook was missed (e.g. a wrong webhook URL).
 * Fetches the transaction from Paystack's verify API, then runs it through the webhook's own
 * crediting path. Idempotent on the Paystack reference: re-running, or the real webhook
 * arriving later, never credits twice.
 *
 * Usage: pnpm requery:dva-topup <paystackReference>
 */
async function requeryDvaTopup(reference: string): Promise<void> {
  loadEnvironmentFiles();
  parseEnvironment();

  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    bufferLogs: true,
    logger: false
  });

  const logger = app.get(JsonLogger);
  app.useLogger(logger);

  try {
    const verified = await app.get(PaystackClient).verifyTransaction(reference);
    if (verified.status !== 'success') {
      throw new Error(`Paystack reports transaction ${reference} as ${verified.status}.`);
    }

    const payload = {
      event: 'charge.success',
      data: verified.providerPayload.data
    } as PaystackWebhookEvent;
    // Refuse rather than record an unattributable top-up: the wallet is found by this number.
    const authorization = payload.data?.authorization;
    if (
      authorization?.channel !== 'dedicated_nuban' ||
      (authorization.receiver_bank_account_number ?? payload.data?.receiver_bank_account_number) ===
        undefined
    ) {
      throw new Error(
        `Transaction ${reference} is not a dedicated-account transfer with a receiver account.`
      );
    }
    const result = await app.get(PaystackWebhookService).creditVerifiedWalletTopup(payload);

    logger.log(
      {
        message:
          result.status === 'duplicate'
            ? 'Top-up was already recorded; nothing credited'
            : 'Top-up processed',
        reference,
        amountKobo: verified.amountKobo,
        result
      },
      'RequeryDvaTopup'
    );
  } finally {
    await app.close();
  }
}

const reference = process.argv[2];
if (reference === undefined || reference.length === 0) {
  console.error('Usage: pnpm requery:dva-topup <paystackReference>');
  process.exit(1);
}

requeryDvaTopup(reference).catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      context: 'RequeryDvaTopup',
      message: error instanceof Error ? error.message : 'Unknown requery failure'
    })
  );
  process.exit(1);
});
