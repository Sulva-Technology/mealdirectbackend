import { BadGatewayException, BadRequestException, Inject, Injectable } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type {
  PaystackClientContract,
  PaystackInitializeInput,
  PaystackInitializeResult,
  PaystackRecipientInput,
  PaystackRecipientResult,
  PaystackRefundInput,
  PaystackRefundResult,
  PaystackTransferInput,
  PaystackTransferResult,
  PaystackVerifyResult
} from './payments.types.js';

type PaystackEnvelope = {
  status?: boolean;
  message?: string;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function badGateway(message: string): BadGatewayException {
  return new BadGatewayException({
    code: ErrorCodes.INTERNAL_SERVER_ERROR,
    message
  });
}

@Injectable()
export class PaystackClient implements PaystackClientContract {
  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  async initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
    const envelope = await this.request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountKobo,
        currency: input.currency,
        email: input.email,
        metadata: input.metadata,
        reference: input.reference
      })
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack initialization returned an invalid response.');
    }

    const authorizationUrl = stringFrom(envelope.data.authorization_url);
    const accessCode = stringFrom(envelope.data.access_code);
    const reference = stringFrom(envelope.data.reference);
    if (authorizationUrl === undefined || accessCode === undefined || reference === undefined) {
      throw badGateway('Paystack initialization response was missing checkout details.');
    }

    return {
      accessCode,
      authorizationUrl,
      providerPayload: this.providerPayload(envelope),
      reference
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResult> {
    const envelope = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET'
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack verification returned an invalid response.');
    }

    const status = stringFrom(envelope.data.status);
    const verifiedReference = stringFrom(envelope.data.reference);
    const amountKobo = numberFrom(envelope.data.amount);
    const currency = stringFrom(envelope.data.currency);
    const transactionId = stringFrom(envelope.data.id) ?? numberFrom(envelope.data.id)?.toString();

    if (
      status === undefined ||
      verifiedReference === undefined ||
      amountKobo === undefined ||
      currency === undefined ||
      transactionId === undefined
    ) {
      throw badGateway('Paystack verification response was missing payment details.');
    }

    return {
      amountKobo,
      currency,
      providerPayload: this.providerPayload(envelope),
      reference: verifiedReference,
      status,
      transactionId
    };
  }

  async createRefund(input: PaystackRefundInput): Promise<PaystackRefundResult> {
    const body: Record<string, unknown> = {
      amount: input.amountKobo,
      transaction: input.transaction
    };
    if (input.reasonText !== undefined) {
      body.customer_note = input.reasonText;
      body.merchant_note = input.reasonText;
    }

    const envelope = await this.request('/refund', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack refund returned an invalid response.');
    }

    const id = stringFrom(envelope.data.id) ?? numberFrom(envelope.data.id);
    const status = stringFrom(envelope.data.status) ?? 'pending';
    const amountKobo = numberFrom(envelope.data.amount) ?? input.amountKobo;
    if (id === undefined) {
      throw badGateway('Paystack refund response was missing a refund reference.');
    }

    return {
      amountKobo,
      id,
      providerPayload: this.providerPayload(envelope),
      status
    };
  }

  async createTransferRecipient(input: PaystackRecipientInput): Promise<PaystackRecipientResult> {
    const envelope = await this.request('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: input.currency
      })
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack recipient returned an invalid response.');
    }

    const recipientCode = stringFrom(envelope.data.recipient_code);
    if (recipientCode === undefined) {
      throw badGateway('Paystack recipient response was missing a code.');
    }

    return { providerPayload: this.providerPayload(envelope), recipientCode };
  }

  async initiateTransfer(input: PaystackTransferInput): Promise<PaystackTransferResult> {
    const envelope = await this.request('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason
      })
    });

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack transfer returned an invalid response.');
    }

    const transferCode = stringFrom(envelope.data.transfer_code);
    const status = stringFrom(envelope.data.status) ?? 'pending';
    if (transferCode === undefined) {
      throw badGateway('Paystack transfer response was missing a code.');
    }

    return { providerPayload: this.providerPayload(envelope), status, transferCode };
  }

  private async request(path: string, init: RequestInit): Promise<PaystackEnvelope> {
    const secret = this.env.get('PAYSTACK_SECRET_KEY');
    if (secret === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Paystack is not configured.'
      });
    }

    const response = await fetch(`${this.env.get('PAYSTACK_BASE_URL')}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json'
      }
    });
    const payload = await response.json();

    if (!isRecord(payload)) {
      throw badGateway('Paystack returned a malformed response.');
    }

    const envelope = payload as PaystackEnvelope;
    if (!response.ok || envelope.status !== true) {
      throw badGateway(stringFrom(envelope.message) ?? 'Paystack rejected the payment request.');
    }

    return envelope;
  }

  private providerPayload(envelope: PaystackEnvelope): Record<string, unknown> {
    return {
      ...(envelope.status === undefined ? {} : { status: envelope.status }),
      ...(envelope.message === undefined ? {} : { message: envelope.message }),
      ...(isRecord(envelope.data) ? { data: envelope.data } : {})
    };
  }
}
