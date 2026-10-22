// Exactly one of vendorId / riderId is set.
export type WithdrawalBeneficiary =
  | { vendorId: string; riderId?: undefined }
  | { riderId: string; vendorId?: undefined };

export type WithdrawalBalance = {
  // Earnings past the hold, net of refunds, that a withdrawal would pay now. Can be negative
  // when refunds exceed earnings; the deficit comes off future earnings.
  availableKobo: number;
  // Delivered earnings still inside the hold window.
  pendingKobo: number;
  // Withdrawals sent to Paystack and not yet confirmed.
  processingKobo: number;
  minimumKobo: number;
  holdMinutes: number;
  payoutAccountReady: boolean;
  enabled: boolean;
  canWithdraw: boolean;
};

export type WithdrawalRequestOutcome =
  | { outcome: 'created'; settlementId: string; amountKobo: number }
  | {
      outcome: 'disabled' | 'no_payout_account' | 'below_minimum';
      amountKobo: number;
      minimumKobo: number;
    };

export type WithdrawalResult = {
  settlementId: string;
  amountKobo: number;
  // pending: Paystack accepted the transfer; success: already paid; processing: outcome is
  // being confirmed and completes automatically.
  status: 'pending' | 'success' | 'processing';
  reference: string | null;
};

export type WithdrawalsRepositoryContract = {
  hasVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  findRiderIdForUser: (userId: string, riderId?: string) => Promise<string | undefined>;
  getBalance: (
    beneficiary: WithdrawalBeneficiary
  ) => Promise<Omit<WithdrawalBalance, 'canWithdraw'>>;
  requestWithdrawal: (
    beneficiary: WithdrawalBeneficiary,
    requestedBy: string
  ) => Promise<WithdrawalRequestOutcome>;
};
