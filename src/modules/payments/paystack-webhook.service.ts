import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { DatabaseService } from '../../database/database.service.js';
import type { DatabaseSchema } from '../../database/database.types.js';
import { mapPaystackEvent, type PaystackWebhookEvent } from '../../domain/payments.js';

type WebhookResult =
  | {
      status: 'accepted';
      eventType: Exclude<ReturnType<typeof mapPaystackEvent>['type'], 'IGNORED'>;
      providerReference: string;
    }
  | {
      status: 'duplicate';
      providerReference: string;
    }
  | {
      status: 'ignored';
      reason: 'UNMAPPED_EVENT' | 'MISSING_REFERENCE';
    };

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function unauthorized(message: string): UnauthorizedException {
  return new UnauthorizedException({
    code: ErrorCodes.UNAUTHORIZED,
    message
  });
}

@Injectable()
export class PaystackWebhookService {
  private readonly processedWebhookKeys = new Set<string>();

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  process(
    rawBody: string,
    signature: string | undefined,
    payload: PaystackWebhookEvent
  ): Promise<WebhookResult> {
    this.assertValidSignature(rawBody, signature);

    const event = mapPaystackEvent(payload);
    if (event.type === 'IGNORED') {
      return Promise.resolve({
        status: 'ignored',
        reason: event.reason
      });
    }

    if (this.env.get('PAYSTACK_WEBHOOK_INBOX_MODE') === 'database') {
      return this.processWithDatabase(rawBody, payload, event);
    }

    const webhookKey = `${payload.event}:${event.providerReference}`;
    if (this.processedWebhookKeys.has(webhookKey)) {
      return Promise.resolve({
        status: 'duplicate',
        providerReference: event.providerReference
      });
    }

    this.processedWebhookKeys.add(webhookKey);
    return Promise.resolve({
      status: 'accepted',
      eventType: event.type,
      providerReference: event.providerReference
    });
  }

  private async processWithDatabase(
    rawBody: string,
    payload: PaystackWebhookEvent,
    event: Exclude<ReturnType<typeof mapPaystackEvent>, { type: 'IGNORED' }>
  ): Promise<WebhookResult> {
    try {
      return await this.runWebhookTransaction(rawBody, payload, event);
    } catch (error) {
      // The transaction (event insert included) rolled back, so Paystack will retry.
      // Record a durable, deduplicated issue in its own transaction so admins can see
      // the failing event even while retries continue, then rethrow to signal Paystack.
      await this.recordProcessingFailure(event.providerReference, error).catch(() => undefined);
      throw error;
    }
  }

  private runWebhookTransaction(
    rawBody: string,
    payload: PaystackWebhookEvent,
    event: Exclude<ReturnType<typeof mapPaystackEvent>, { type: 'IGNORED' }>
  ): Promise<WebhookResult> {
    return this.database.db.transaction().execute(async (trx) => {
      const inserted = await this.recordPaymentEvent(
        trx,
        rawBody,
        payload,
        event.providerReference
      );
      if (!inserted) {
        return {
          status: 'duplicate',
          providerReference: event.providerReference
        };
      }

      if (event.type === 'PAYMENT_SUCCEEDED') {
        await this.applyVerifiedPayment(trx, payload, event);
      }

      if (event.type === 'TRANSFER_RECONCILED') {
        await this.reconcileTransfer(trx, payload, event.providerReference, event.status);
      }

      return {
        status: 'accepted',
        eventType: event.type,
        providerReference: event.providerReference
      };
    });
  }

  private async recordPaymentEvent(
    trx: Kysely<DatabaseSchema>,
    rawBody: string,
    payload: PaystackWebhookEvent,
    providerReference: string
  ): Promise<boolean> {
    const fingerprint = createHash('sha256').update(rawBody).digest('hex');
    const result = await sql<{ inserted: boolean }>`
      select public.record_payment_event(
        'paystack'::public.payment_provider,
        ${fingerprint},
        ${payload.event},
        ${providerReference},
        true,
        ${rawBody}::jsonb
      ) as inserted
    `.execute(trx);

    return result.rows[0]?.inserted ?? false;
  }

  /**
   * Apply a signed `charge.success` to the local order — but only after the webhook's
   * amount and currency are validated against the initialized payment. On any mismatch,
   * or when the reference has no local payment, we DO NOT mark the order paid; instead we
   * record a reconciliation issue for admin review. The event row stays committed (so
   * Paystack stops retrying) while the order remains unpaid and flagged.
   */
  private async applyVerifiedPayment(
    trx: Kysely<DatabaseSchema>,
    payload: PaystackWebhookEvent,
    event: Extract<
      Exclude<ReturnType<typeof mapPaystackEvent>, { type: 'IGNORED' }>,
      { type: 'PAYMENT_SUCCEEDED' }
    >
  ): Promise<void> {
    const reference = event.providerReference;
    const local = await sql<{
      id: string;
      orderId: string;
      expectedAmountKobo: number;
      currency: string;
      status: string;
    }>`
      select
        id::text as "id",
        order_id::text as "orderId",
        expected_amount_kobo as "expectedAmountKobo",
        currency,
        status::text as "status"
      from public.payments
      where provider = 'paystack'::public.payment_provider
        and provider_reference = ${reference}
      order by created_at desc
      limit 1
    `.execute(trx);

    const payment = local.rows[0];

    if (payment === undefined) {
      await this.recordIssue(
        trx,
        `provider_success_not_local:${reference}`,
        'provider_success_not_local',
        'critical',
        null,
        null,
        reference,
        { webhookAmountKobo: event.amountKobo }
      );
      return;
    }

    if (event.amountKobo !== payment.expectedAmountKobo) {
      await this.recordIssue(
        trx,
        `amount_mismatch:${payment.id}`,
        'amount_mismatch',
        'critical',
        payment.id,
        payment.orderId,
        reference,
        { expectedAmountKobo: payment.expectedAmountKobo, webhookAmountKobo: event.amountKobo }
      );
      return;
    }

    if (event.currency !== undefined && event.currency !== payment.currency) {
      await this.recordIssue(
        trx,
        `currency_mismatch:${payment.id}`,
        'currency_mismatch',
        'critical',
        payment.id,
        payment.orderId,
        reference,
        { expectedCurrency: payment.currency, webhookCurrency: event.currency }
      );
      return;
    }

    const transactionId = payload.data?.id?.toString() ?? reference;
    await sql`
      select public.mark_verified_payment_successful(
        'paystack'::public.payment_provider,
        ${reference},
        ${transactionId},
        ${event.amountKobo},
        ${JSON.stringify(payload)}::jsonb
      )
    `.execute(trx);
  }

  private async recordProcessingFailure(providerReference: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'unknown webhook processing error';
    await this.recordIssue(
      this.database.db,
      `webhook_processing_failed:${providerReference}`,
      'webhook_processing_failed',
      'critical',
      null,
      null,
      providerReference,
      { error: message }
    );
  }

  private async recordIssue(
    trx: Kysely<DatabaseSchema>,
    dedupKey: string,
    issueType:
      | 'amount_mismatch'
      | 'currency_mismatch'
      | 'provider_success_not_local'
      | 'webhook_processing_failed',
    severity: 'info' | 'warning' | 'critical',
    paymentId: string | null,
    orderId: string | null,
    providerReference: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await sql`
      select public.upsert_payment_reconciliation_issue(
        ${dedupKey},
        ${issueType}::public.payment_reconciliation_issue_type,
        ${severity}::public.payment_reconciliation_severity,
        ${paymentId}::uuid,
        ${orderId}::uuid,
        ${providerReference},
        ${JSON.stringify(detail)}::jsonb
      )
    `.execute(trx);
  }

  private async reconcileTransfer(
    trx: Kysely<DatabaseSchema>,
    payload: PaystackWebhookEvent,
    reference: string,
    status: 'success' | 'failed' | 'reversed'
  ): Promise<void> {
    await sql`
      select public.reconcile_payout_transfer(
        ${reference},
        ${status},
        ${JSON.stringify(payload)}::jsonb
      )
    `.execute(trx);
  }

  private assertValidSignature(rawBody: string, signature: string | undefined): void {
    const secret = this.env.get('PAYSTACK_SECRET_KEY');
    if (secret === undefined) {
      throw unauthorized('Paystack webhook verification is not configured.');
    }

    if (signature === undefined || signature.length === 0) {
      throw unauthorized('Paystack signature is required.');
    }

    const expectedSignature = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (!safeCompare(signature, expectedSignature)) {
      throw unauthorized('Paystack signature is invalid.');
    }
  }
}
