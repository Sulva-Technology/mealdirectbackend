import type { DedicatedAccountStatus, WalletEntryType, WalletStatus } from '../../domain/wallet.js';

export type DedicatedAccountRecord = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
};

export type WalletRecord = {
  id: string;
  userId: string;
  balanceKobo: number;
  currency: string;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerWalletView = {
  balanceKobo: number;
  currency: string;
  status: WalletStatus;
  minTopupKobo: number;
  maxBalanceKobo: number;
  depositFeeBps: number;
  dedicatedAccount: DedicatedAccountRecord | null;
};

export type WalletLedgerEntryRecord = {
  id: string;
  entryType: WalletEntryType;
  amountKobo: number;
  balanceAfterKobo: number;
  orderId: string | null;
  orderNumber: string | null;
  providerReference: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminWalletRecord = WalletRecord & {
  userEmail: string | null;
  userDisplayName: string | null;
  accountNumber: string | null;
  overCap: boolean;
};

export type WalletPage<T> = {
  items: T[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type WalletLimits = {
  minTopupKobo: number;
  maxBalanceKobo: number;
};

export type PlatformSettingRecord = {
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type WalletTopupCheckout = {
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  amountKobo: number;
  feeKobo: number;
  chargeKobo: number;
  depositFeeKobo: number;
  creditKobo: number;
};

export type WalletTopupQuote = {
  /** Amount deposited (before the deposit fee). */
  amountKobo: number;
  /** Paystack processing fee added on top at checkout. */
  feeKobo: number;
  /** Total charged at checkout: amount + processing fee. */
  chargeKobo: number;
  /** MealDirect deposit fee deducted from the amount. */
  depositFeeKobo: number;
  /** What lands in the wallet. */
  creditKobo: number;
};

export type DedicatedAccountUpsert = {
  walletId: string;
  paystackCustomerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
  providerPayload: Record<string, unknown>;
};

export type WalletsRepositoryContract = {
  ensureWallet(userId: string): Promise<string>;
  findWalletByUserId(userId: string): Promise<WalletRecord | undefined>;
  findWalletById(walletId: string): Promise<WalletRecord | undefined>;
  findDedicatedAccount(walletId: string): Promise<DedicatedAccountRecord | null>;
  listLedgerEntries(
    walletId: string,
    pagination: { cursor?: string; limit: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>>;
  listWallets(
    pagination: { cursor?: string; limit: number },
    maxBalanceKobo: number
  ): Promise<WalletPage<AdminWalletRecord>>;
  adjustWallet(
    walletId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<WalletRecord>;
  setWalletStatus(walletId: string, status: WalletStatus): Promise<WalletRecord>;
  upsertDedicatedAccount(input: DedicatedAccountUpsert): Promise<DedicatedAccountRecord>;
  listWalletIdsMissingDedicatedAccount(
    limit: number
  ): Promise<{ walletId: string; userId: string }[]>;
};
