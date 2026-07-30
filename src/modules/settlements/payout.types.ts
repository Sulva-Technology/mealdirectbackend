export type PayoutContext = {
  settlementId: string;
  payableKobo: number;
  // Transfer recipient provisioned when the beneficiary's bank details were captured;
  // null means payouts cannot run until the account is (re)provisioned.
  recipientCode: string | null;
};

export type PayoutDestination = {
  settlementId: string;
  payableKobo: number;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
};

export type PayoutTransferRecord = {
  id: string;
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string | null;
  status: string;
  attempt: number;
};

export type RecordTransferInput = {
  settlementId: string;
  attempt: number;
  reference: string;
  amountKobo: number;
  providerTransferCode: string;
  status: string;
  initiatedBy: string | null;
  providerPayload: Record<string, unknown>;
};

export type PayoutGuardrails = {
  holdHours: number;
  maxAttempts: number;
};

// Admin queue view of a transfer, with the derived needs-admin flag.
export type PayoutTransferListItem = {
  id: string;
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string | null;
  status: string;
  attempt: number;
  needsAdmin: boolean;
  createdAt: string;
};

export type PayoutTransferPage = {
  items: PayoutTransferListItem[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type PayoutRepositoryContract = {
  findActiveTransfer: (settlementId: string) => Promise<PayoutTransferRecord | undefined>;
  findPayoutContext: (settlementId: string) => Promise<PayoutContext | undefined>;
  nextAttempt: (settlementId: string) => Promise<number>;
  recordTransfer: (input: RecordTransferInput) => Promise<PayoutTransferRecord>;
  getPayoutGuardrails: () => Promise<PayoutGuardrails>;
  selectPayableSettlements: (guardrails: PayoutGuardrails, limit: number) => Promise<string[]>;
  listPendingTransfers: (
    graceSeconds: number,
    limit: number
  ) => Promise<Array<{ id: string; reference: string }>>;
  applyReconcile: (
    reference: string,
    status: 'success' | 'failed' | 'reversed',
    payload: Record<string, unknown>
  ) => Promise<void>;
  listTransfers: (input: {
    status?: string;
    maxAttempts: number;
    limit: number;
    cursor?: string;
  }) => Promise<PayoutTransferPage>;
  findTransferById: (id: string) => Promise<PayoutTransferListItem | undefined>;
};
