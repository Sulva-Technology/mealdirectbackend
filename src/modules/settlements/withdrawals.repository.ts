import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  WithdrawalBalance,
  WithdrawalBeneficiary,
  WithdrawalRequestOutcome,
  WithdrawalsRepositoryContract
} from './withdrawals.types.js';

@Injectable()
export class WithdrawalsRepository implements WithdrawalsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async hasVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  // Same resolution as the rider profile: JWT rider_id when present, else riders.user_id.
  async findRiderIdForUser(userId: string, riderId?: string): Promise<string | undefined> {
    const result = await sql<{ id: string }>`
      select r.id::text as "id"
      from public.riders r
      where r.user_id = ${userId}::uuid
        and (${riderId ?? null}::uuid is null or r.id = ${riderId ?? null}::uuid)
        and public.has_rider_access(r.id, ${userId}::uuid)
      order by r.active desc, r.created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0]?.id;
  }

  async getBalance(
    beneficiary: WithdrawalBeneficiary
  ): Promise<Omit<WithdrawalBalance, 'canWithdraw'>> {
    const vendorId = beneficiary.vendorId ?? null;
    const riderId = beneficiary.riderId ?? null;

    const result = await sql<Omit<WithdrawalBalance, 'canWithdraw'>>`
      with settings as (
        select
          public.platform_setting_int('withdrawal_hold_minutes', 120) as hold_minutes,
          public.platform_setting_int('withdrawal_min_kobo', 100000) as minimum_kobo,
          public.on_demand_payouts_start_date() is not null as enabled
      ),
      available as (
        select l.amount_kobo
        from settings st,
          public.vendor_withdrawable_lines(
            ${vendorId}::uuid, now() - make_interval(mins => st.hold_minutes)
          ) l
        where ${vendorId}::uuid is not null
        union all
        select l.amount_kobo
        from settings st,
          public.rider_withdrawable_lines(
            ${riderId}::uuid, now() - make_interval(mins => st.hold_minutes)
          ) l
        where ${riderId}::uuid is not null
      ),
      everything as (
        select l.amount_kobo
        from public.vendor_withdrawable_lines(${vendorId}::uuid, now()) l
        where ${vendorId}::uuid is not null
        union all
        select l.amount_kobo
        from public.rider_withdrawable_lines(${riderId}::uuid, now()) l
        where ${riderId}::uuid is not null
      )
      select
        coalesce((select sum(amount_kobo) from available), 0)::integer as "availableKobo",
        (
          coalesce((select sum(amount_kobo) from everything), 0)
          - coalesce((select sum(amount_kobo) from available), 0)
        )::integer as "pendingKobo",
        coalesce((
          select sum(s.payable_kobo)
          from public.settlements s
          where s.kind = 'on_demand'
            and s.status = 'approved'
            and (s.vendor_id = ${vendorId}::uuid or s.rider_id = ${riderId}::uuid)
        ), 0)::integer as "processingKobo",
        st.minimum_kobo as "minimumKobo",
        st.hold_minutes as "holdMinutes",
        exists (
          select 1 from public.vendor_payout_accounts vpa
          where vpa.vendor_id = ${vendorId}::uuid
            and vpa.active
            and vpa.paystack_recipient_code is not null
            and vpa.admin_review_status = 'approved'
          union all
          select 1 from public.rider_payout_accounts rpa
          where rpa.rider_id = ${riderId}::uuid
            and rpa.active
            and rpa.paystack_recipient_code is not null
            and rpa.admin_review_status = 'approved'
        ) as "payoutAccountReady",
        st.enabled as "enabled"
      from settings st
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Withdrawal balance query returned no row.');
    }
    return row;
  }

  async requestWithdrawal(
    beneficiary: WithdrawalBeneficiary,
    requestedBy: string
  ): Promise<WithdrawalRequestOutcome> {
    const result = await sql<{
      outcome: WithdrawalRequestOutcome['outcome'];
      settlementId: string | null;
      amountKobo: number;
      minimumKobo: number;
    }>`
      select
        w.outcome,
        w.settlement_id::text as "settlementId",
        w.amount_kobo as "amountKobo",
        public.platform_setting_int('withdrawal_min_kobo', 100000) as "minimumKobo"
      from public.request_withdrawal(
        ${beneficiary.vendorId ?? null}::uuid,
        ${beneficiary.riderId ?? null}::uuid,
        ${requestedBy}::uuid
      ) w
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Withdrawal request returned no row.');
    }
    if (row.outcome === 'created') {
      if (row.settlementId === null) {
        throw new Error('Withdrawal was created without a settlement id.');
      }
      return { outcome: 'created', settlementId: row.settlementId, amountKobo: row.amountKobo };
    }
    return { outcome: row.outcome, amountKobo: row.amountKobo, minimumKobo: row.minimumKobo };
  }
}
