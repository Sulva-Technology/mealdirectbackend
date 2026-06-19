export type PayoutBeneficiary = 'vendor' | 'rider';

export type PayoutContext = {
  settlementId: string;
  beneficiary: PayoutBeneficiary;
  // vendor_payout_accounts.id for a vendor settlement, riders.id for a rider settlement.
  beneficiaryRefId: string;
  payableKobo: number;
  recipientCode: string | null;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
};

export type PayoutTransferRecord = {
  id: string;
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string | null;
  status: string;
};

export type RecordTransferInput = {
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string;
  status: string;
  initiatedBy: string;
  providerPayload: Record<string, unknown>;
};

export type PayoutRepositoryContract = {
  findTransferBySettlement: (settlementId: string) => Promise<PayoutTransferRecord | undefined>;
  findPayoutContext: (settlementId: string) => Promise<PayoutContext | undefined>;
  saveRecipientCode: (context: PayoutContext, recipientCode: string) => Promise<void>;
  recordTransfer: (input: RecordTransferInput) => Promise<PayoutTransferRecord>;
};
