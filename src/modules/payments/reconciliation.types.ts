export type ReconciliationIssueType =
  | 'initialized_unconfirmed'
  | 'paid_order_pending'
  | 'webhook_processing_failed'
  | 'provider_success_not_local'
  | 'duplicate_success'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'refund_stuck';

export type ReconciliationIssueStatus = 'open' | 'investigating' | 'resolved' | 'ignored';

export type ReconciliationSeverity = 'info' | 'warning' | 'critical';

export type ReconciliationIssueRecord = {
  id: string;
  issueType: ReconciliationIssueType;
  status: ReconciliationIssueStatus;
  severity: ReconciliationSeverity;
  paymentId: string | null;
  orderId: string | null;
  refundId: string | null;
  campusId: string | null;
  providerReference: string | null;
  detail: Record<string, unknown>;
  firstDetectedAt: string;
  lastDetectedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolutionNote: string | null;
};

export type ReconciliationNoteRecord = {
  id: string;
  issueId: string;
  authorId: string | null;
  body: string;
  createdAt: string;
};

export type ReconciliationIssueDetail = ReconciliationIssueRecord & {
  notes: ReconciliationNoteRecord[];
};

export type ReconciliationIssueListFilter = {
  status?: ReconciliationIssueStatus;
  issueType?: ReconciliationIssueType;
  severity?: ReconciliationSeverity;
};

export type ReconciliationIssueListResult = {
  items: ReconciliationIssueRecord[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type ReconciliationCursor = {
  lastDetectedAt: string;
  id: string;
};
