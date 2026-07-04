import type { OrderDetail, OrderStatus } from '../orders/orders.types.js';
import type { SettlementStatus } from '../settlements/settlements.types.js';

export type RiderStatus = 'deactivated' | 'pending' | 'suspended' | 'verified';
export type DeliveryAssignmentStatus =
  | 'accepted'
  | 'assigned'
  | 'cancelled'
  | 'completed'
  | 'picked_up';

export type RiderProfile = {
  id: string;
  campusId: string;
  campusName: string;
  userId: string;
  displayName: string;
  phone: string;
  status: RiderStatus;
  active: boolean;
  available: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RiderProfileUpdateInput = {
  displayName?: string;
  phone?: string;
};

export type RiderOnboardInput = {
  campusId: string;
  displayName: string;
  phone: string;
};

export type RiderOnboardRepositoryInput = RiderOnboardInput & {
  userId: string;
};

export type RiderPayoutAccount = {
  id: string;
  riderId: string;
  paystackRecipientCode: string | null;
  bankName: string;
  bankCode: string | null;
  maskedAccountNumber: string;
  accountName: string;
  verifiedAt: string | null;
  adminReviewStatus: 'pending' | 'approved' | 'rejected';
  failureReason: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Rider-facing payout account snapshot. `payoutMode` is 'manual' at launch: bank details
 * and a Paystack transfer recipient are captured, but rider settlement payouts are still
 * disbursed by an admin rather than auto-transferred.
 */
export type RiderPayoutAccountView = RiderPayoutAccount & {
  verificationStatus: 'verified' | 'unverified';
  payoutMode: 'manual';
};

export type RiderPayoutTransfer = {
  id: string;
  settlementId: string;
  settlementDate: string | null;
  reference: string;
  amountKobo: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RiderPayoutAccountInput = {
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
};

// The full account number is provisioned into a Paystack recipient at capture time,
// so the repository only ever persists the mask plus the returned recipient code.
export type RiderPayoutAccountRecordInput = Omit<RiderPayoutAccountInput, 'accountNumber'> & {
  maskedAccountNumber: string;
  paystackRecipientCode: string;
};

export type RiderAssignmentSummary = {
  id: string;
  batchId: string;
  riderId: string;
  vendorId: string;
  vendorDisplayName: string;
  vendorPhone: string | null;
  serviceDate: string;
  deliverySlotId: string;
  deliverySlotName: string;
  deliveryTime: string;
  zoneId: string;
  zoneName: string;
  status: DeliveryAssignmentStatus;
  batchStatus: string;
  orderCount: number;
  deliveryEarningsKobo: number;
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
};

export type RiderAssignmentDetail = RiderAssignmentSummary & {
  orders: OrderDetail[];
};

export type RiderAssignmentListFilters = {
  cursor?: string;
  date?: string;
  status?: DeliveryAssignmentStatus;
  limit: number;
};

export type RiderOrderDetail = OrderDetail & {
  assignmentId: string;
  batchId: string;
  assignmentStatus: DeliveryAssignmentStatus;
  customerDisplayName: string | null;
  customerPhone: string | null;
  deliveryInstructions: string | null;
  zoneName: string;
};

export type RiderIssueInput = {
  category: string;
  description: string;
};

export type RiderIssueRecord = {
  id: string;
  orderId: string;
  category: string;
  description: string;
  status: string;
  openedAt: string;
};

export type RiderEarningsBatch = {
  assignmentId: string;
  batchId: string;
  serviceDate: string;
  vendorId: string;
  vendorDisplayName: string;
  deliveredOrderCount: number;
  confirmedOrderCount: number;
  pendingAmountKobo: number;
  settledAmountKobo: number;
  totalAmountKobo: number;
  settlementId: string | null;
  settlementStatus: SettlementStatus | null;
};

export type RiderEarningsSummary = {
  riderId: string;
  dateFrom: string | null;
  dateTo: string | null;
  deliveredOrderCount: number;
  confirmedOrderCount: number;
  pendingAmountKobo: number;
  settledAmountKobo: number;
  totalAmountKobo: number;
  currency: 'NGN';
  ratePerOrderKobo: number;
  batches: RiderEarningsBatch[];
};

export type RiderSettlementSummary = {
  id: string;
  campusId: string;
  riderId: string;
  settlementDate: string;
  status: SettlementStatus;
  deliveryEarningsKobo: number;
  adjustmentsKobo: number;
  payableKobo: number;
  paidAt: string | null;
  externalReference: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RiderSettlementLine = {
  id: string;
  settlementId: string;
  orderId: string | null;
  orderNumber: string | null;
  lineType: string;
  amountKobo: number;
  description: string;
  createdAt: string;
};

export type RiderSettlementDetail = RiderSettlementSummary & {
  lines: RiderSettlementLine[];
};

export type RiderSettlementListFilters = {
  cursor?: string;
  status?: SettlementStatus;
  limit: number;
};

export type RidersRepositoryContract = {
  findRiderProfileForActor: (userId: string, riderId?: string) => Promise<RiderProfile | undefined>;
  findRiderIdForUser: (userId: string) => Promise<string | undefined>;
  onboardRider: (input: RiderOnboardRepositoryInput) => Promise<RiderProfile>;
  updateRiderProfile: (
    riderId: string,
    userId: string,
    input: RiderProfileUpdateInput
  ) => Promise<RiderProfile | undefined>;
  setRiderAvailability: (
    riderId: string,
    userId: string,
    available: boolean
  ) => Promise<RiderProfile | undefined>;
  findActivePayoutAccount: (riderId: string) => Promise<RiderPayoutAccount | undefined>;
  upsertPayoutAccount: (
    riderId: string,
    input: RiderPayoutAccountRecordInput
  ) => Promise<RiderPayoutAccount>;
  markPayoutAccountVerified: (riderId: string) => Promise<RiderPayoutAccount | undefined>;
  listPayoutTransfers: (
    riderId: string,
    pagination: { cursor?: string; limit: number }
  ) => Promise<RiderPayoutTransfer[]>;
  assertRiderAccess: (riderId: string, userId: string) => Promise<boolean>;
  listAssignments: (
    riderId: string,
    filters: RiderAssignmentListFilters
  ) => Promise<RiderAssignmentSummary[]>;
  findAssignmentById: (
    riderId: string,
    assignmentId: string
  ) => Promise<RiderAssignmentSummary | undefined>;
  findAssignmentOrders: (batchId: string) => Promise<OrderDetail[]>;
  acceptAssignment: (
    riderId: string,
    assignmentId: string
  ) => Promise<RiderAssignmentSummary | undefined>;
  markAssignmentPickedUp: (
    riderId: string,
    assignmentId: string
  ) => Promise<RiderAssignmentSummary | undefined>;
  findAssignedOrderById: (
    riderId: string,
    orderId: string
  ) => Promise<RiderOrderDetail | undefined>;
  transitionAssignedOrderStatus: (
    riderId: string,
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string
  ) => Promise<OrderStatus>;
  createOrderIssue: (
    riderId: string,
    orderId: string,
    actorUserId: string,
    input: RiderIssueInput
  ) => Promise<RiderIssueRecord | undefined>;
  getEarningsSummary: (
    riderId: string,
    dateFrom?: string,
    dateTo?: string
  ) => Promise<RiderEarningsSummary>;
  listRiderSettlements: (
    riderId: string,
    filters: RiderSettlementListFilters
  ) => Promise<RiderSettlementSummary[]>;
  findRiderSettlementById: (
    riderId: string,
    settlementId: string
  ) => Promise<RiderSettlementDetail | undefined>;
};
