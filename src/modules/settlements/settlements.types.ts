export type SettlementStatus = 'approved' | 'cancelled' | 'draft' | 'paid';

export type SettlementSummary = {
  id: string;
  campusId: string;
  vendorId: string | null;
  riderId: string | null;
  settlementDate: string;
  status: SettlementStatus;
  grossFoodAmountKobo: number;
  deliveryEarningsKobo: number;
  refundsKobo: number;
  adjustmentsKobo: number;
  payableKobo: number;
  paidAt: string | null;
  externalReference: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SettlementLine = {
  id: string;
  settlementId: string;
  orderId: string | null;
  orderNumber: string | null;
  lineType: string;
  amountKobo: number;
  description: string;
  createdAt: string;
};

export type SettlementDetail = SettlementSummary & {
  lines: SettlementLine[];
};

export type SettlementListFilters = {
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit: number;
};

export type SettlementCursor = {
  settlementDate: string;
  id: string;
};

export type SettlementsRepositoryContract = {
  assertVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  listVendorSettlements: (
    vendorId: string,
    filters: SettlementListFilters
  ) => Promise<SettlementSummary[]>;
  findVendorSettlementById: (
    vendorId: string,
    settlementId: string
  ) => Promise<SettlementDetail | undefined>;
};
