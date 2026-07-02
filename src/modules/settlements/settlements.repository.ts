import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  SettlementDetail,
  SettlementLine,
  SettlementListFilters,
  SettlementSummary,
  SettlementsRepositoryContract
} from './settlements.types.js';

@Injectable()
export class SettlementsRepository implements SettlementsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async listVendorSettlements(
    vendorId: string,
    filters: SettlementListFilters
  ): Promise<SettlementSummary[]> {
    const cursorDate = filters.cursor?.split('|')[0] ?? null;
    const cursorId = filters.cursor?.split('|')[1] ?? null;

    const result = await sql<SettlementSummary>`
      select
        s.id::text as "id",
        s.campus_id::text as "campusId",
        s.vendor_id::text as "vendorId",
        s.rider_id::text as "riderId",
        s.settlement_date::text as "settlementDate",
        s.status::text as "status",
        s.gross_food_amount_kobo as "grossFoodAmountKobo",
        s.delivery_earnings_kobo as "deliveryEarningsKobo",
        s.service_fee_kobo as "serviceFeeKobo",
        s.refunds_kobo as "refundsKobo",
        s.adjustments_kobo as "adjustmentsKobo",
        s.payable_kobo as "payableKobo",
        s.paid_at::text as "paidAt",
        s.external_reference as "externalReference",
        count(sl.id)::integer as "lineCount",
        s.created_at::text as "createdAt",
        s.updated_at::text as "updatedAt"
      from public.settlements s
      left join public.settlement_lines sl on sl.settlement_id = s.id
      where s.vendor_id = ${vendorId}::uuid
        and (${filters.dateFrom ?? null}::date is null or s.settlement_date >= ${filters.dateFrom ?? null}::date)
        and (${filters.dateTo ?? null}::date is null or s.settlement_date <= ${filters.dateTo ?? null}::date)
        and (
          ${cursorDate}::date is null
          or (s.settlement_date, s.id) < (${cursorDate}::date, ${cursorId}::uuid)
        )
      group by s.id
      order by s.settlement_date desc, s.id desc
      limit ${filters.limit + 1}
    `.execute(this.database.db);

    return result.rows;
  }

  async findVendorSettlementById(
    vendorId: string,
    settlementId: string
  ): Promise<SettlementDetail | undefined> {
    const settlementResult = await sql<SettlementSummary>`
      select
        s.id::text as "id",
        s.campus_id::text as "campusId",
        s.vendor_id::text as "vendorId",
        s.rider_id::text as "riderId",
        s.settlement_date::text as "settlementDate",
        s.status::text as "status",
        s.gross_food_amount_kobo as "grossFoodAmountKobo",
        s.delivery_earnings_kobo as "deliveryEarningsKobo",
        s.service_fee_kobo as "serviceFeeKobo",
        s.refunds_kobo as "refundsKobo",
        s.adjustments_kobo as "adjustmentsKobo",
        s.payable_kobo as "payableKobo",
        s.paid_at::text as "paidAt",
        s.external_reference as "externalReference",
        count(sl.id)::integer as "lineCount",
        s.created_at::text as "createdAt",
        s.updated_at::text as "updatedAt"
      from public.settlements s
      left join public.settlement_lines sl on sl.settlement_id = s.id
      where s.vendor_id = ${vendorId}::uuid
        and s.id = ${settlementId}::uuid
      group by s.id
      limit 1
    `.execute(this.database.db);

    const settlement = settlementResult.rows[0];
    if (settlement === undefined) return undefined;

    return {
      ...settlement,
      lines: await this.listSettlementLines(settlementId)
    };
  }

  private async listSettlementLines(settlementId: string): Promise<SettlementLine[]> {
    const result = await sql<SettlementLine>`
      select
        sl.id::text as "id",
        sl.settlement_id::text as "settlementId",
        sl.order_id::text as "orderId",
        o.order_number as "orderNumber",
        sl.line_type as "lineType",
        sl.amount_kobo as "amountKobo",
        sl.description,
        sl.created_at::text as "createdAt"
      from public.settlement_lines sl
      left join public.orders o on o.id = sl.order_id
      where sl.settlement_id = ${settlementId}::uuid
      order by sl.created_at asc, sl.id asc
    `.execute(this.database.db);

    return result.rows;
  }
}
