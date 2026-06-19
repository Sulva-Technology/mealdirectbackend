import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { Promotion } from '../../domain/promotions.js';
import type {
  CreatePromotionInput,
  PromotionRecord,
  PromotionsRepositoryContract
} from './promotions.types.js';

type ActivePromotionRow = Promotion & {
  perUserLimit: number;
  totalUsageLimit: number | null;
};

const recordColumns = sql`
  id::text as "id",
  campus_id::text as "campusId",
  code,
  discount_type as "discountType",
  discount_value as "discountValue",
  min_order_kobo as "minOrderKobo",
  max_discount_kobo as "maxDiscountKobo",
  starts_at::text as "startsAt",
  ends_at::text as "endsAt",
  total_usage_limit as "totalUsageLimit",
  per_user_limit as "perUserLimit",
  active,
  created_at::text as "createdAt",
  updated_at::text as "updatedAt"
`;

@Injectable()
export class PromotionsRepository implements PromotionsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findActiveByCode(code: string): Promise<ActivePromotionRow | undefined> {
    const result = await sql<ActivePromotionRow>`
      select
        id::text as "id",
        code,
        discount_type as "discountType",
        discount_value as "discountValue",
        min_order_kobo as "minOrderKobo",
        max_discount_kobo as "maxDiscountKobo",
        starts_at::text as "startsAt",
        ends_at::text as "endsAt",
        per_user_limit as "perUserLimit",
        total_usage_limit as "totalUsageLimit",
        active
      from public.promotions
      where code = ${code}
        and active
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async countUserRedemptions(promotionId: string, userId: string): Promise<number> {
    const result = await sql<{ count: number }>`
      select count(*)::int as count
      from public.promotion_redemptions
      where promotion_id = ${promotionId}::uuid
        and user_id = ${userId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.count ?? 0;
  }

  async countTotalRedemptions(promotionId: string): Promise<number> {
    const result = await sql<{ count: number }>`
      select count(*)::int as count
      from public.promotion_redemptions
      where promotion_id = ${promotionId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.count ?? 0;
  }

  async createPromotion(input: CreatePromotionInput): Promise<PromotionRecord> {
    const result = await sql<PromotionRecord>`
      insert into public.promotions (
        campus_id,
        code,
        discount_type,
        discount_value,
        min_order_kobo,
        max_discount_kobo,
        starts_at,
        ends_at,
        total_usage_limit,
        per_user_limit
      )
      values (
        ${input.campusId ?? null}::uuid,
        ${input.code},
        ${input.discountType},
        ${input.discountValue},
        ${input.minOrderKobo ?? 0},
        ${input.maxDiscountKobo ?? null},
        coalesce(${input.startsAt ?? null}::timestamptz, now()),
        ${input.endsAt ?? null}::timestamptz,
        ${input.totalUsageLimit ?? null},
        ${input.perUserLimit ?? 1}
      )
      returning ${recordColumns}
    `.execute(this.database.db);

    const promotion = result.rows[0];
    if (promotion === undefined) {
      throw new Error('Promotion creation did not return a row.');
    }
    return promotion;
  }

  async listPromotions(): Promise<PromotionRecord[]> {
    const result = await sql<PromotionRecord>`
      select ${recordColumns}
      from public.promotions
      order by created_at desc
    `.execute(this.database.db);

    return result.rows;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await sql`
      update public.promotions
      set active = ${active}
      where id = ${id}::uuid
    `.execute(this.database.db);
  }
}
