export type PaymentStatus = 'failed' | 'initialized' | 'pending' | 'refunded' | 'successful';

export type RefundStatus =
  | 'approved'
  | 'cancelled'
  | 'failed'
  | 'processing'
  | 'requested'
  | 'succeeded';

export type PaymentInitializationRecord = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerEmail: string | null;
  campusId: string;
  orderStatus: string;
  orderTotalKobo: number;
  providerReference: string;
  paymentStatus: PaymentStatus;
  expectedAmountKobo: number;
  currency: string;
};

export type PaymentRecord = PaymentInitializationRecord & {
  paidAmountKobo: number | null;
  providerTransactionId: string | null;
  providerPayload: Record<string, unknown>;
  initializedAt: string;
  paidAt: string | null;
  verifiedAt: string | null;
};

export type AdminPaymentRecord = Omit<PaymentRecord, 'providerPayload'>;

export type AdminPaymentListFilter = {
  status?: PaymentStatus;
  vendorId?: string;
  customerId?: string;
  reference?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type AdminPaymentListResult = {
  items: AdminPaymentRecord[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type AdminPaymentDetail = AdminPaymentRecord & {
  webhookReceived: boolean;
  webhookCount: number;
  verificationStatus: 'verified' | 'unverified';
  refundStatus: RefundStatus | 'none';
  refundedAmountKobo: number;
  settlementImpactKobo: number;
};

export type PaymentTimelineEvent = {
  at: string;
  type: string;
  source: 'order' | 'payment_event' | 'refund';
  detail: Record<string, unknown>;
};

export type PaymentWebhookRecord = {
  id: string;
  eventType: string;
  providerReference: string | null;
  signatureValid: boolean;
  receivedAt: string;
  processedAt: string | null;
  processingError: string | null;
};

export type RefundRecord = {
  id: string;
  paymentId: string;
  orderId: string;
  providerRefundReference: string | null;
  amountKobo: number;
  reasonCode: string;
  reasonText: string | null;
  status: RefundStatus;
  requestedBy: string | null;
  requestedAt: string;
  processedAt: string | null;
};

export type PaystackInitializeInput = {
  email: string;
  amountKobo: number;
  currency: string;
  reference: string;
  metadata: Record<string, string>;
};

export type PaystackInitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  providerPayload: Record<string, unknown>;
};

export type PaystackVerifyResult = {
  status: string;
  reference: string;
  amountKobo: number;
  currency: string;
  transactionId: string;
  providerPayload: Record<string, unknown>;
};

export type PaystackRefundInput = {
  transaction: string;
  amountKobo: number;
  reasonText?: string;
};

export type PaystackRefundResult = {
  id: string | number;
  status: string;
  amountKobo: number;
  providerPayload: Record<string, unknown>;
};

export type PaystackRecipientInput = {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
};

export type PaystackRecipientResult = {
  recipientCode: string;
  providerPayload: Record<string, unknown>;
};

export type PaystackTransferInput = {
  amountKobo: number;
  recipientCode: string;
  reference: string;
  reason?: string;
};

export type PaystackTransferResult = {
  transferCode: string;
  status: string;
  providerPayload: Record<string, unknown>;
};

export type PaystackClientContract = {
  initializeTransaction: (input: PaystackInitializeInput) => Promise<PaystackInitializeResult>;
  verifyTransaction: (reference: string) => Promise<PaystackVerifyResult>;
  createRefund: (input: PaystackRefundInput) => Promise<PaystackRefundResult>;
  createTransferRecipient: (input: PaystackRecipientInput) => Promise<PaystackRecipientResult>;
  initiateTransfer: (input: PaystackTransferInput) => Promise<PaystackTransferResult>;
};

export type RefundInput = {
  amountKobo: number;
  reasonCode: string;
  reasonText?: string;
};

export type PaymentsRepositoryContract = {
  findCustomerInitializationPayment: (
    customerId: string,
    orderId: string
  ) => Promise<PaymentInitializationRecord | undefined>;
  findStuckPaystackPayments: (
    staleSeconds: number,
    limit: number
  ) => Promise<PaymentInitializationRecord[]>;
  markPaymentInitializationPayload: (
    paymentId: string,
    providerPayload: Record<string, unknown>
  ) => Promise<PaymentRecord>;
  listAdminPaymentsPaged: (
    filter: AdminPaymentListFilter,
    pagination: { cursor?: string; limit: number },
    campusId?: string
  ) => Promise<AdminPaymentListResult>;
  findAdminPaymentById: (
    paymentId: string,
    campusId?: string
  ) => Promise<PaymentRecord | undefined>;
  getPaymentDetail: (
    paymentId: string,
    campusId?: string
  ) => Promise<AdminPaymentDetail | undefined>;
  getPaymentTimeline: (paymentId: string) => Promise<PaymentTimelineEvent[]>;
  getPaymentWebhooks: (providerReference: string) => Promise<PaymentWebhookRecord[]>;
  markPaymentSuccessfulFromProvider: (
    providerReference: string,
    providerTransactionId: string,
    paidAmountKobo: number,
    providerPayload: Record<string, unknown>
  ) => Promise<string>;
  getRefundedAmountKobo: (paymentId: string) => Promise<number>;
  createRefundRequest: (
    paymentId: string,
    input: RefundInput,
    requestedBy: string
  ) => Promise<RefundRecord>;
  updateRefundProviderPayload: (
    refundId: string,
    providerRefundReference: string,
    providerPayload: Record<string, unknown>,
    status: RefundStatus
  ) => Promise<RefundRecord>;
};

export type PaymentInitializationResponse = {
  paymentId: string;
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type PaymentReconciliationResponse = {
  paymentId: string;
  orderId: string;
  providerReference: string;
  status: 'successful';
};
