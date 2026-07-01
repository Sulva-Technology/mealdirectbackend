import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  ReferralAnalytics,
  ReferralAnalyticsQuery,
  ReferralAnalyticsRow,
  ReferralAnalyticsSummary,
  ReferralsRepositoryContract
} from './referrals.types.js';

@Injectable()
export class ReferralsRepository implements ReferralsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensureReferralCode(userId: string): Promise<string> {
    const result = await sql<{ code: string }>`
      select public.ensure_referral_code(${userId}::uuid) as "code"
    `.execute(this.database.db);

    const code = result.rows[0]?.code;
    if (code === undefined || code === null) {
      throw new Error('Failed to ensure referral code.');
    }
    return code;
  }

  async countReferred(userId: string): Promise<number> {
    const result = await sql<{ count: number }>`
      select count(*)::integer as "count"
      from public.referrals
      where referrer_id = ${userId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.count ?? 0;
  }

  async hasRedeemed(userId: string): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      select exists (
        select 1 from public.referrals where referred_id = ${userId}::uuid
      ) as "exists"
    `.execute(this.database.db);

    return result.rows[0]?.exists ?? false;
  }

  async isOnboardingComplete(userId: string): Promise<boolean> {
    const result = await sql<{ complete: boolean }>`
      select (onboarding_completed_at is not null) as "complete"
      from public.profiles
      where id = ${userId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.complete ?? false;
  }

  async findReferrerByCode(code: string): Promise<{ id: string } | undefined> {
    const result = await sql<{ id: string }>`
      select id::text as "id"
      from public.profiles
      where referral_code = ${code}
    `.execute(this.database.db);

    return result.rows[0];
  }

  async insertReferral(referredId: string, referrerId: string, code: string): Promise<void> {
    await sql`
      insert into public.referrals (referred_id, referrer_id, code_used)
      values (${referredId}::uuid, ${referrerId}::uuid, ${code})
    `.execute(this.database.db);
  }

  async getAnalytics(query: ReferralAnalyticsQuery): Promise<ReferralAnalytics> {
    const campusId = query.campusId ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;

    // "Spent" counts orders that were actually paid for and not refunded.
    // Filters are applied to the referred user's orders, not the referrer's.
    const rows = await sql<ReferralAnalyticsRow>`
      with paid_orders as (
        select
          o.customer_id,
          o.total_kobo
        from public.orders o
        where o.paid_at is not null
          and o.order_status <> 'refunded'
          and (${campusId}::uuid is null or o.campus_id = ${campusId}::uuid)
          and (${from}::date is null or o.paid_at >= ${from}::date)
          and (${to}::date is null or o.paid_at < (${to}::date + interval '1 day'))
      )
      select
        p.id::text as "referrerId",
        p.display_name as "referrerName",
        p.email::text as "referrerEmail",
        count(distinct r.referred_id)::integer as "referredCount",
        count(distinct po.customer_id)::integer as "payingReferredCount",
        count(po.customer_id)::integer as "paidOrders",
        coalesce(sum(po.total_kobo), 0)::integer as "totalSpentKobo"
      from public.referrals r
      join public.profiles p on p.id = r.referrer_id
      left join paid_orders po on po.customer_id = r.referred_id
      group by p.id, p.display_name, p.email
      order by "totalSpentKobo" desc, "referredCount" desc
      limit ${query.limit}
    `.execute(this.database.db);

    const summaryResult = await sql<ReferralAnalyticsSummary>`
      with paid_orders as (
        select
          o.customer_id,
          o.total_kobo
        from public.orders o
        where o.paid_at is not null
          and o.order_status <> 'refunded'
          and (${campusId}::uuid is null or o.campus_id = ${campusId}::uuid)
          and (${from}::date is null or o.paid_at >= ${from}::date)
          and (${to}::date is null or o.paid_at < (${to}::date + interval '1 day'))
      )
      select
        count(distinct r.referrer_id)::integer as "referrers",
        count(distinct r.referred_id)::integer as "referredUsers",
        count(distinct po.customer_id)::integer as "payingReferredUsers",
        count(po.customer_id)::integer as "paidOrders",
        coalesce(sum(po.total_kobo), 0)::integer as "totalSpentKobo"
      from public.referrals r
      left join paid_orders po on po.customer_id = r.referred_id
    `.execute(this.database.db);

    const summary = summaryResult.rows[0] ?? {
      referrers: 0,
      referredUsers: 0,
      payingReferredUsers: 0,
      paidOrders: 0,
      totalSpentKobo: 0
    };

    return { summary, referrers: rows.rows };
  }
}
