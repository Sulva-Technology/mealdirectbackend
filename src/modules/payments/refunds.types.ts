import type { RefundStatus } from './payments.types.js';

export type AdminRefundRecord = {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string | null;
  campusId: string | null;
  vendorId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  providerReference: string | null;
  providerTransactionId: string | null;
  providerRefundReference: string | null;
  amountKobo: number;
  reasonCode: string;
  reasonText: string | null;
  status: RefundStatus;
  failureReason: string | null;
  resolutionNote: string | null;
  requestedBy: string | null;
  resolvedBy: string | null;
  requestedAt: string;
  processedAt: string | null;
  updatedAt: string | null;
};

export type AdminRefundListFilter = {
  status?: RefundStatus;
};

export type AdminRefundListResult = {
  items: AdminRefundRecord[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};
