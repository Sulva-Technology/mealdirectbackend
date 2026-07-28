export type PaystackWebhookEvent = {
  event: string;
  data?: {
    id?: string | number;
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    receiver_bank_account_number?: string;
    authorization?: {
      channel?: string;
      receiver_bank_account_number?: string;
      sender_name?: string;
    };
  };
};

export type PaymentDomainEvent =
  | {
      type: 'PAYMENT_SUCCEEDED';
      providerReference: string;
      amountKobo: number;
      currency?: string;
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
      type: 'WALLET_TOPUP_SUCCEEDED';
      providerReference: string;
      amountKobo: number;
      accountNumber?: string;
      senderName?: string;
      currency?: string;
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

  // Money landing on a customer dedicated virtual account. This must be decided before the
  // ordinary charge.success branch: a top-up has no order, so the order-reference lookup
  // downstream would file a spurious provider_success_not_local issue for every top-up.
  if (
    input.event === 'charge.success' &&
    input.data?.authorization?.channel === 'dedicated_nuban'
  ) {
    const accountNumber =
      input.data.authorization.receiver_bank_account_number ??
      input.data.receiver_bank_account_number;
    const senderName = input.data.authorization.sender_name;
    return {
      type: 'WALLET_TOPUP_SUCCEEDED',
      providerReference: reference,
      amountKobo: input.data.amount ?? 0,
      ...(accountNumber === undefined ? {} : { accountNumber }),
      ...(senderName === undefined ? {} : { senderName }),
      ...(input.data.currency === undefined ? {} : { currency: input.data.currency })
    };
  }

  if (input.event === 'charge.success') {
    return {
      type: 'PAYMENT_SUCCEEDED',
      providerReference: reference,
      amountKobo: input.data?.amount ?? 0,
      ...(input.data?.currency === undefined ? {} : { currency: input.data.currency })
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
