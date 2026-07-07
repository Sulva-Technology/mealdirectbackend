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
  recordTransfer: (input: RecordTransferInput) => Promise<PayoutTransferRecord>;
};
