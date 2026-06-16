import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { sql } from 'kysely';

import { createCursorPage, decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type { CursorPage, CursorPayload } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { DatabaseService } from '../../database/database.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { VendorSettlementListQueryDto } from './dto/vendor-settlement.dto.js';
import { SettlementsRepository } from './settlements.repository.js';
import type {
  SettlementDetail,
  SettlementSummary,
  SettlementsRepositoryContract
} from './settlements.types.js';

type SettlementResult = {
  settlement_id: string;
};

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

function decodeSettlementCursor(cursor: string): string {
  let payload: CursorPayload;
  try {
    payload = decodeCursor(cursor);
  } catch {
    throw badRequest('Invalid settlement cursor.');
  }

  if (typeof payload.settlementDate !== 'string' || typeof payload.id !== 'string') {
    throw badRequest('Invalid settlement cursor.');
  }

  return `${payload.settlementDate}|${payload.id}`;
}

@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettlementsRepository)
    private readonly repository: SettlementsRepositoryContract
  ) {}

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

  async listVendorSettlements(
    actor: AuthenticatedActor,
    query: VendorSettlementListQueryDto
  ): Promise<CursorPage<SettlementSummary>> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);
    this.assertDateRange(query.dateFrom, query.dateTo);

    const limit = query.limit ?? 20;
    const rows = await this.repository.listVendorSettlements(vendorId, {
      ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
      ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
      ...(query.cursor === undefined ? {} : { cursor: decodeSettlementCursor(query.cursor) }),
      limit
    });

    return createCursorPage(rows, limit, (settlement) =>
      encodeCursor({
        id: settlement.id,
        settlementDate: settlement.settlementDate
      })
    );
  }

  async getVendorSettlement(
    actor: AuthenticatedActor,
    settlementId: string
  ): Promise<SettlementDetail> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const settlement = await this.repository.findVendorSettlementById(vendorId, settlementId);
    if (settlement === undefined) {
      throw notFound('Settlement was not found.');
    }

    return settlement;
  }

  private toSettlementResult(row: SettlementResult | undefined): { settlementId: string } {
    if (row?.settlement_id === undefined) {
      throw new Error('Settlement generation did not return a settlement ID.');
    }
    return { settlementId: row.settlement_id };
  }

  private assertAndGetVendorId(actor: AuthenticatedActor): string {
    if (actor.role !== 'vendor' || actor.vendorId === undefined || actor.vendorId.length === 0) {
      throw forbidden('Vendor access is required.');
    }
    return actor.vendorId;
  }

  private async assertVendorAccess(vendorId: string, userId: string): Promise<void> {
    const hasAccess = await this.repository.assertVendorAccess(vendorId, userId);
    if (!hasAccess) {
      throw forbidden('Vendor access is required.');
    }
  }

  private assertDateRange(dateFrom: string | undefined, dateTo: string | undefined): void {
    if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
      throw badRequest('dateFrom must be before or equal to dateTo.');
    }
  }
}
