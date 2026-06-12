import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';

type SettlementResult = {
  settlement_id: string;
};

@Injectable()
export class SettlementsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async generateVendorDailySettlement(
    actor: AuthenticatedActor,
    vendorId: string,
    settlementDate: string
  ): Promise<{ settlementId: string }> {
    const result = await sql<SettlementResult>`
      select public.produce_vendor_daily_settlement(
        ${vendorId}::uuid,
        ${settlementDate}::date,
        ${actor.userId}::uuid
      ) as settlement_id
    `.execute(this.database.db);

    return this.toSettlementResult(result.rows[0]);
  }

  async generateRiderDailySettlement(
    actor: AuthenticatedActor,
    riderId: string,
    settlementDate: string
  ): Promise<{ settlementId: string }> {
    const result = await sql<SettlementResult>`
      select public.produce_rider_daily_settlement(
        ${riderId}::uuid,
        ${settlementDate}::date,
        ${actor.userId}::uuid
      ) as settlement_id
    `.execute(this.database.db);

    return this.toSettlementResult(result.rows[0]);
  }

  private toSettlementResult(row: SettlementResult | undefined): { settlementId: string } {
    if (row?.settlement_id === undefined) {
      throw new Error('Settlement generation did not return a settlement ID.');
    }
    return { settlementId: row.settlement_id };
  }
}
