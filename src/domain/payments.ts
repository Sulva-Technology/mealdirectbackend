export type PaystackWebhookEvent = {
  event: string;
  data?: {
    id?: string | number;
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    receiver_bank_account_number?: string;
    // Echoed back from transaction/initialize. Paystack usually returns the object we sent,
    // but some channels deliver it as a JSON string, so both shapes are accepted.
    metadata?: Record<string, unknown> | string | null;
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
      userId?: string;
      /** Amount to credit when the charge included a passed-on processing fee. */
      creditKobo?: number;
      senderName?: string;
      currency?: string;
    }
  | {
      type: 'IGNORED';
      reason: 'UNMAPPED_EVENT' | 'MISSING_REFERENCE';
      providerEvent: string;
    };

/** Metadata purpose stamped on checkout-funded wallet top-ups (POST /wallet/topup). */
export const WALLET_TOPUP_PURPOSE = 'wallet_topup';

function metadataRecord(
  metadata: Record<string, unknown> | string | null | undefined
): Record<string, unknown> | undefined {
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return metadata ?? undefined;
}

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

  // Checkout-funded wallet top-up. Same reasoning as the DVA branch: it has no order, so it
  // must be routed before the order-payment branch. The wallet is resolved by user id.
  const metadata = metadataRecord(input.data?.metadata);
  if (
    input.event === 'charge.success' &&
    metadata?.purpose === WALLET_TOPUP_PURPOSE &&
    typeof metadata.userId === 'string' &&
    metadata.userId.length > 0
  ) {
    const creditKobo = Number(metadata.creditKobo);
    return {
      type: 'WALLET_TOPUP_SUCCEEDED',
      providerReference: reference,
      amountKobo: input.data?.amount ?? 0,
      userId: metadata.userId,
      ...(Number.isInteger(creditKobo) && creditKobo > 0 ? { creditKobo } : {}),
      ...(input.data?.currency === undefined ? {} : { currency: input.data.currency })
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
