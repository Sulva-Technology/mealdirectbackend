import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
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

  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  process(
    rawBody: string,
    signature: string | undefined,
    payload: PaystackWebhookEvent
  ): WebhookResult {
    this.assertValidSignature(rawBody, signature);

    const event = mapPaystackEvent(payload);
    if (event.type === 'IGNORED') {
      return {
        status: 'ignored',
        reason: event.reason
      };
    }

    const webhookKey = `${payload.event}:${event.providerReference}`;
    if (this.processedWebhookKeys.has(webhookKey)) {
      return {
        status: 'duplicate',
        providerReference: event.providerReference
      };
    }

    this.processedWebhookKeys.add(webhookKey);
    return {
      status: 'accepted',
      eventType: event.type,
      providerReference: event.providerReference
    };
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
