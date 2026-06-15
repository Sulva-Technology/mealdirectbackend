import type { OrderSummary } from '../orders/orders.types.js';

export type BatchStatus = 'open' | 'closed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export type BatchSummary = {
  id: string;
  campusId: string;
  vendorId: string;
  serviceDate: string;
  deliverySlotId: string;
  zoneId: string;
  batchNumber: string;
  status: BatchStatus;
  deliveryMode: string;
  orderCount: number;
  deliveryEarningsKobo: number;
  cutoffAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BatchDetail = BatchSummary & {
  orders: OrderSummary[];
};

export type BatchListFilters = {
  status?: BatchStatus;
  date?: string;
};

export type BatchesRepositoryContract = {
  assertVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  listVendorBatches: (vendorId: string, filters: BatchListFilters) => Promise<BatchSummary[]>;
  findVendorBatchById: (vendorId: string, batchId: string) => Promise<BatchSummary | undefined>;
  findBatchOrders: (batchId: string) => Promise<OrderSummary[]>;
  pickupBatch: (batchId: string, actorUserId: string) => Promise<void>;
};
