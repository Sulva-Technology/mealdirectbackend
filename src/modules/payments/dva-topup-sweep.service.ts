import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { PaystackWebhookEvent } from '../../domain/payments.js';
import { PaystackClient } from './paystack.client.js';
import { PaystackWebhookService } from './paystack-webhook.service.js';

const MAX_PAGES = 10;

export type DvaTopupSweepResult = {
  /** Dedicated-account transfers Paystack reported in the window. */
  seen: number;
  /** Of those, transfers no wallet had been credited for. */
  missing: number;
  credited: number;
  failed: number;
};

/**
 * Safety net for missed webhooks (wrong URL, outage, bad key): lists recent successful
 * dedicated-account transfers on Paystack and credits any that no wallet ledger entry holds,
 * through the webhook's own crediting path. Idempotent on the Paystack reference, so it never
 * double-credits — whether the webhook landed first, lands later, or the sweep runs twice.
 */
@Injectable()
export class DvaTopupSweepService {
  constructor(
    @Inject(PaystackClient) private readonly paystack: PaystackClient,
    @Inject(PaystackWebhookService) private readonly webhooks: PaystackWebhookService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  async sweep(lookbackHours = 72, now = new Date()): Promise<DvaTopupSweepResult> {
    const fromIso = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();
    const references: string[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { transactions, pageCount } = await this.paystack.listSuccessfulTransactions(
        fromIso,
        page
      );
      for (const transaction of transactions) {
        const authorization = transaction.authorization as { channel?: unknown } | undefined;
        if (
          authorization?.channel === 'dedicated_nuban' &&
          typeof transaction.reference === 'string'
        ) {
          references.push(transaction.reference);
        }
      }
      if (page >= pageCount) break;
    }

    if (references.length === 0) {
      return { seen: 0, missing: 0, credited: 0, failed: 0 };
    }

    const creditedAlready = await this.creditedReferences(references);
    const missing = references.filter((reference) => !creditedAlready.has(reference));

    let credited = 0;
    let failed = 0;
    for (const reference of missing) {
      try {
        const verified = await this.paystack.verifyTransaction(reference);
        if (verified.status !== 'success') continue;
        const payload = {
          event: 'charge.success',
          data: verified.providerPayload.data
        } as PaystackWebhookEvent;
        const result = await this.webhooks.creditVerifiedWalletTopup(payload);
        if (result.status === 'accepted') credited += 1;
      } catch {
        // Recorded as a reconciliation issue by the webhook path; retried on the next sweep.
        failed += 1;
      }
    }

    return { seen: references.length, missing: missing.length, credited, failed };
  }

  /** The references among these that a wallet top-up ledger entry already holds. */
  async creditedReferences(references: readonly string[]): Promise<Set<string>> {
    const recorded = await sql<{ reference: string }>`
      select provider_reference as "reference"
      from public.wallet_ledger_entries
      where entry_type = 'topup' and provider_reference = any(${references}::text[])
    `.execute(this.database.db);
    return new Set(recorded.rows.map((row) => row.reference));
  }
}
