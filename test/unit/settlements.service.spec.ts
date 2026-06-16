import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeCursor } from '../../src/common/api/pagination.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { SettlementsService } from '../../src/modules/settlements/settlements.service.js';
import type {
  SettlementDetail,
  SettlementSummary,
  SettlementsRepositoryContract
} from '../../src/modules/settlements/settlements.types.js';

const vendorId = '66666666-6666-4666-8666-666666666666';
const vendor: AuthenticatedActor = {
  role: 'vendor',
  userId: '99999999-9999-4999-8999-999999999999',
  vendorId
};

const settlement: SettlementSummary = {
  adjustmentsKobo: 0,
  campusId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-06-15T09:00:00.000Z',
  deliveryEarningsKobo: 50000,
  externalReference: null,
  grossFoodAmountKobo: 150000,
  id: '77777777-7777-4777-8777-777777777777',
  lineCount: 2,
  paidAt: null,
  payableKobo: 200000,
  refundsKobo: 0,
  riderId: null,
  settlementDate: '2026-06-15',
  status: 'draft',
  updatedAt: '2026-06-15T09:00:00.000Z',
  vendorId
};

const settlementDetail: SettlementDetail = {
  ...settlement,
  lines: [
    {
      amountKobo: 150000,
      createdAt: '2026-06-15T09:00:00.000Z',
      description: 'Food subtotal for MD-1001',
      id: '88888888-8888-4888-8888-888888888888',
      lineType: 'food',
      orderId: '99999999-9999-4999-8999-999999999999',
      orderNumber: 'MD-1001',
      settlementId: settlement.id
    }
  ]
};

function createRepository(): SettlementsRepositoryContract {
  return {
    assertVendorAccess: vi.fn().mockResolvedValue(true),
    findVendorSettlementById: vi.fn().mockResolvedValue(settlementDetail),
    listVendorSettlements: vi.fn().mockResolvedValue([settlement])
  };
}

describe('SettlementsService vendor read models', () => {
  let repository: SettlementsRepositoryContract;
  let service: SettlementsService;

  beforeEach(() => {
    repository = createRepository();
    service = new SettlementsService({} as DatabaseService, repository);
  });

  it('lists vendor settlements with decoded cursor and date filters', async () => {
    const cursor = encodeCursor({
      id: settlement.id,
      settlementDate: settlement.settlementDate
    });

    await expect(
      service.listVendorSettlements(vendor, {
        cursor,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        limit: 10
      })
    ).resolves.toMatchObject({
      items: [settlement],
      pagination: {
        hasMore: false,
        limit: 10
      }
    });

    expect(repository.assertVendorAccess).toHaveBeenCalledWith(vendorId, vendor.userId);
    expect(repository.listVendorSettlements).toHaveBeenCalledWith(vendorId, {
      cursor: `${settlement.settlementDate}|${settlement.id}`,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      limit: 10
    });
  });

  it('gets vendor settlement detail and hides settlements outside scope', async () => {
    await expect(service.getVendorSettlement(vendor, settlement.id)).resolves.toEqual(
      settlementDetail
    );

    vi.mocked(repository.findVendorSettlementById).mockResolvedValueOnce(undefined);
    await expect(service.getVendorSettlement(vendor, settlement.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('rejects vendor settlement access without membership or valid filters', async () => {
    vi.mocked(repository.assertVendorAccess).mockResolvedValueOnce(false);
    await expect(service.listVendorSettlements(vendor, { limit: 20 })).rejects.toBeInstanceOf(
      ForbiddenException
    );

    await expect(
      service.listVendorSettlements(vendor, {
        dateFrom: '2026-06-30',
        dateTo: '2026-06-01',
        limit: 20
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.listVendorSettlements(vendor, {
        cursor: 'not-a-cursor',
        limit: 20
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
