export type PaystackWebhookEvent = {
  event: string;
  data?: {
    id?: string | number;
    reference?: string;
    amount?: number;
    status?: string;
  };
};

export type PaymentDomainEvent =
  | {
      type: 'PAYMENT_SUCCEEDED';
      providerReference: string;
      amountKobo: number;
    }
  | {
      type: 'PAYMENT_FAILED';
      providerReference: string;
      amountKobo?: number;
    }
  | {
      type: 'REFUND_SUCCEEDED';
      providerReference: string;
      amountKobo?: number;
    }
  | {
      type: 'TRANSFER_RECONCILED';
      providerReference: string;
      status: 'success' | 'failed' | 'reversed';
    }
  | {
      type: 'IGNORED';
      reason: 'UNMAPPED_EVENT' | 'MISSING_REFERENCE';
      providerEvent: string;
    };

export function mapPaystackEvent(input: PaystackWebhookEvent): PaymentDomainEvent {
  const reference = input.data?.reference;
  if (reference === undefined || reference.length === 0) {
    return {
      type: 'IGNORED',
      reason: 'MISSING_REFERENCE',
      providerEvent: input.event
    };
  }

  if (input.event === 'charge.success') {
    return {
      type: 'PAYMENT_SUCCEEDED',
      providerReference: reference,
      amountKobo: input.data?.amount ?? 0
    };
  }

  if (input.event === 'charge.failed') {
    return {
      type: 'PAYMENT_FAILED',
      providerReference: reference,
      ...(input.data?.amount === undefined ? {} : { amountKobo: input.data.amount })
    };
  }

  if (input.event === 'refund.processed') {
    return {
      type: 'REFUND_SUCCEEDED',
      providerReference: reference,
      ...(input.data?.amount === undefined ? {} : { amountKobo: input.data.amount })
    };
  }

  const transferStatus: Record<string, 'success' | 'failed' | 'reversed' | undefined> = {
    'transfer.success': 'success',
    'transfer.failed': 'failed',
    'transfer.reversed': 'reversed'
  };
  const mappedTransfer = transferStatus[input.event];
  if (mappedTransfer !== undefined) {
    return {
      type: 'TRANSFER_RECONCILED',
      providerReference: reference,
      status: mappedTransfer
    };
  }

  return {
    type: 'IGNORED',
    reason: 'UNMAPPED_EVENT',
    providerEvent: input.event
  };
}
