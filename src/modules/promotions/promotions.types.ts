import type { Promotion, PromotionDiscountType } from '../../domain/promotions.js';

export type PromotionRecord = {
  id: string;
  campusId: string | null;
  code: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minOrderKobo: number;
  maxDiscountKobo: number | null;
  startsAt: string;
  endsAt: string | null;
  totalUsageLimit: number | null;
  perUserLimit: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreatePromotionInput = {
  campusId?: string | null;
  code: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minOrderKobo?: number;
  maxDiscountKobo?: number | null;
  startsAt?: string;
  endsAt?: string | null;
  totalUsageLimit?: number | null;
  perUserLimit?: number;
};

export type PromotionValidationResult = {
  code: string;
  discountKobo: number;
};

export type PromotionsRepositoryContract = {
  findActiveByCode: (
    code: string
  ) => Promise<(Promotion & { perUserLimit: number; totalUsageLimit: number | null }) | undefined>;
  countUserRedemptions: (promotionId: string, userId: string) => Promise<number>;
  countTotalRedemptions: (promotionId: string) => Promise<number>;
  createPromotion: (input: CreatePromotionInput) => Promise<PromotionRecord>;
  listPromotions: () => Promise<PromotionRecord[]>;
  setActive: (id: string, active: boolean) => Promise<void>;
};
