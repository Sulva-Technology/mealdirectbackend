export type MyReferral = {
  code: string;
  referredCount: number;
};

export type RedeemReferralResult = {
  referrerId: string;
  code: string;
};

export type ReferralAnalyticsQuery = {
  campusId?: string;
  from?: string;
  to?: string;
  limit: number;
};

export type ReferralAnalyticsRow = {
  referrerId: string;
  referrerName: string | null;
  referrerEmail: string | null;
  referredCount: number;
  payingReferredCount: number;
  paidOrders: number;
  totalSpentKobo: number;
};

export type ReferralAnalyticsSummary = {
  referrers: number;
  referredUsers: number;
  payingReferredUsers: number;
  paidOrders: number;
  totalSpentKobo: number;
};

export type ReferralAnalytics = {
  summary: ReferralAnalyticsSummary;
  referrers: ReferralAnalyticsRow[];
};

export type ReferralsRepositoryContract = {
  ensureReferralCode: (userId: string) => Promise<string>;
  countReferred: (userId: string) => Promise<number>;
  hasRedeemed: (userId: string) => Promise<boolean>;
  isOnboardingComplete: (userId: string) => Promise<boolean>;
  findReferrerByCode: (code: string) => Promise<{ id: string } | undefined>;
  insertReferral: (referredId: string, referrerId: string, code: string) => Promise<void>;
  getAnalytics: (query: ReferralAnalyticsQuery) => Promise<ReferralAnalytics>;
};
