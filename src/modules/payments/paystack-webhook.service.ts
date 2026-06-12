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
        await this.markPaymentSuccessful(trx, payload, event);
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

  private async markPaymentSuccessful(
    trx: Kysely<DatabaseSchema>,
    payload: PaystackWebhookEvent,
    event: Extract<
      Exclude<ReturnType<typeof mapPaystackEvent>, { type: 'IGNORED' }>,
      { type: 'PAYMENT_SUCCEEDED' }
    >
  ): Promise<void> {
    const transactionId = payload.data?.id?.toString() ?? event.providerReference;
    await sql`
      select public.mark_verified_payment_successful(
        'paystack'::public.payment_provider,
        ${event.providerReference},
        ${transactionId},
        ${event.amountKobo},
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
