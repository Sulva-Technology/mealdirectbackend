export type EscalationStatus = 'investigating' | 'open' | 'rejected' | 'resolved';

export type EscalationEligibility = {
  orderId: string;
  orderStatus: string;
};

export type CreateEscalationInput = {
  category: string;
  description: string;
};

export type EscalationRecord = {
  id: string;
  orderId: string;
  openedBy: string;
  category: string;
  description: string;
  status: EscalationStatus;
  assignedAdminId: string | null;
  resolution: string | null;
  refundId: string | null;
  openedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EscalationsRepositoryContract = {
  findCustomerEscalationEligibility: (
    customerId: string,
    orderId: string
  ) => Promise<EscalationEligibility | undefined>;
  findOpenCustomerEscalation: (
    customerId: string,
    orderId: string
  ) => Promise<EscalationRecord | undefined>;
  listCustomerOrderEscalations: (
    customerId: string,
    orderId: string
  ) => Promise<EscalationRecord[]>;
  openCustomerEscalation: (
    customerId: string,
    orderId: string,
    input: CreateEscalationInput
  ) => Promise<EscalationRecord>;
};
