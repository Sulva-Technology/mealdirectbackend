import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeCursor } from '../../src/common/api/pagination.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { RidersService } from '../../src/modules/riders/riders.service.js';
import type {
  RiderAssignmentSummary,
  RiderEarningsSummary,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderProfile,
  RiderSettlementDetail,
  RiderSettlementSummary,
  RidersRepositoryContract
} from '../../src/modules/riders/riders.types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const settlementId = '66666666-6666-4666-8666-666666666666';

const actor: AuthenticatedActor = {
  role: 'rider',
  riderId,
  userId
};

const customer: AuthenticatedActor = {
  role: 'customer',
  userId
};

const profile: RiderProfile = {
  active: true,
  available: false,
  campusId: '77777777-7777-4777-8777-777777777777',
  campusName: 'Venite University',
  createdAt: '2026-06-15T09:00:00.000Z',
  displayName: 'Ada Rider',
  id: riderId,
  phone: '+2348012345678',
  status: 'verified',
  updatedAt: '2026-06-15T09:00:00.000Z',
  userId,
  verifiedAt: '2026-06-15T09:00:00.000Z'
};

const assignment: RiderAssignmentSummary = {
  acceptedAt: null,
  assignedAt: '2026-06-15T09:00:00.000Z',
  batchId,
  batchStatus: 'assigned',
  completedAt: null,
  deliveryEarningsKobo: 7500,
  deliverySlotId: '88888888-8888-4888-8888-888888888888',
  deliverySlotName: 'Lunch',
  deliveryTime: '12:00:00',
  id: assignmentId,
  orderCount: 1,
  pickedUpAt: null,
  riderId,
  serviceDate: '2026-06-15',
  status: 'assigned',
  vendorDisplayName: 'Ada Kitchen',
  vendorId: '99999999-9999-4999-8999-999999999999',
  vendorPhone: '+2348099999999',
  zoneId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  zoneName: 'Zone A'
};

const order: RiderOrderDetail = {
  assignmentId,
  assignmentStatus: 'picked_up',
  batchId,
  campusId: profile.campusId,
  confirmedAt: null,
  createdAt: '2026-06-15T09:00:00.000Z',
  currency: 'NGN',
  customerDisplayName: 'Customer',
  customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  customerPhone: '+2348088888888',
  deliveredAt: null,
  deliveryFeeKobo: 15000,
  deliveryInstructions: 'Call at the gate.',
  deliveryMode: 'meal_direct_rider',
  deliverySlotId: assignment.deliverySlotId,
  deliverySlotName: assignment.deliverySlotName,
  discountKobo: 0,
  foodSubtotalKobo: 250000,
  id: orderId,
  items: [],
  latestPayment: null,
  locationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  locationName: 'Main gate',
  orderNumber: 'MD-1001',
  orderStatus: 'ready',
  paidAt: '2026-06-15T08:00:00.000Z',
  serviceDate: assignment.serviceDate,
  totalKobo: 265000,
  updatedAt: '2026-06-15T09:00:00.000Z',
  vendorDisplayName: assignment.vendorDisplayName,
  vendorId: assignment.vendorId,
  zoneName: assignment.zoneName
};

const issue: RiderIssueRecord = {
  category: 'rider_customer_unavailable',
  description: 'Customer did not answer.',
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  openedAt: '2026-06-15T09:00:00.000Z',
  orderId,
  status: 'open'
};

const earnings: RiderEarningsSummary = {
  batches: [],
  confirmedOrderCount: 0,
  currency: 'NGN',
  dateFrom: '2026-06-01',
  dateTo: '2026-06-30',
  deliveredOrderCount: 1,
  pendingAmountKobo: 7500,
  ratePerOrderKobo: 7500,
  riderId,
  settledAmountKobo: 0,
  totalAmountKobo: 7500
};

const settlement: RiderSettlementSummary = {
  adjustmentsKobo: 0,
  campusId: profile.campusId,
  createdAt: '2026-06-15T09:00:00.000Z',
  deliveryEarningsKobo: 7500,
  externalReference: null,
  id: settlementId,
  lineCount: 1,
  paidAt: null,
  payableKobo: 7500,
  riderId,
  settlementDate: '2026-06-15',
  status: 'draft',
  updatedAt: '2026-06-15T09:00:00.000Z'
};

const settlementDetail: RiderSettlementDetail = {
  ...settlement,
  lines: []
};

type MockRidersRepository = {
  [K in keyof RidersRepositoryContract]: ReturnType<typeof vi.fn>;
};

function createRepository(): MockRidersRepository {
  return {
    acceptAssignment: vi.fn().mockResolvedValue({ ...assignment, status: 'accepted' }),
    assertRiderAccess: vi.fn().mockResolvedValue(true),
    createOrderIssue: vi.fn().mockResolvedValue(issue),
    findAssignedOrderById: vi.fn().mockResolvedValue(order),
    findAssignmentById: vi.fn().mockResolvedValue(assignment),
    findAssignmentOrders: vi.fn().mockResolvedValue([order]),
    findRiderProfileForActor: vi.fn().mockResolvedValue(profile),
    findRiderSettlementById: vi.fn().mockResolvedValue(settlementDetail),
    getEarningsSummary: vi.fn().mockResolvedValue(earnings),
    listAssignments: vi.fn().mockResolvedValue([assignment]),
    listRiderSettlements: vi.fn().mockResolvedValue([settlement]),
    markAssignmentPickedUp: vi.fn().mockResolvedValue({ ...assignment, status: 'picked_up' }),
    setRiderAvailability: vi.fn().mockResolvedValue({ ...profile, available: true }),
    transitionAssignedOrderStatus: vi.fn().mockResolvedValue('out_for_delivery'),
    updateRiderProfile: vi.fn().mockResolvedValue(profile)
  };
}

describe('RidersService', () => {
  let repository: MockRidersRepository;
  let service: RidersService;

  beforeEach(() => {
    repository = createRepository();
    service = new RidersService(repository as unknown as RidersRepositoryContract);
  });

  it('reads and updates an own rider profile', async () => {
    await expect(service.getProfile(actor)).resolves.toEqual(profile);
    await expect(
      service.updateProfile(actor, {
        displayName: '  Ada Rider  ',
        phone: '+2348012345678'
      })
    ).resolves.toEqual(profile);

    expect(repository.findRiderProfileForActor).toHaveBeenCalledWith(userId, riderId);
    expect(repository.updateRiderProfile).toHaveBeenCalledWith(riderId, userId, {
      displayName: 'Ada Rider',
      phone: '+2348012345678'
    });
  });

  it('sets availability for a verified active rider', async () => {
    await expect(service.setAvailability(actor, true)).resolves.toMatchObject({
      available: true
    });

    expect(repository.assertRiderAccess).toHaveBeenCalledWith(riderId, userId);
    expect(repository.setRiderAvailability).toHaveBeenCalledWith(riderId, userId, true);
  });

  it('lists assignments with cursor and scoped rider access', async () => {
    const cursor = encodeCursor({ assignedAt: assignment.assignedAt, id: assignment.id });

    await expect(
      service.listAssignments(actor, {
        cursor,
        date: '2026-06-15',
        limit: 10,
        status: 'assigned'
      })
    ).resolves.toMatchObject({
      items: [assignment],
      pagination: { hasMore: false, limit: 10 }
    });

    expect(repository.assertRiderAccess).toHaveBeenCalledWith(riderId, userId);
    expect(repository.listAssignments).toHaveBeenCalledWith(riderId, {
      cursor: `${assignment.assignedAt}|${assignment.id}`,
      date: '2026-06-15',
      limit: 10,
      status: 'assigned'
    });
  });

  it('accepts and marks assignments picked up only when transition result matches', async () => {
    await expect(service.acceptAssignment(actor, assignmentId)).resolves.toMatchObject({
      id: assignmentId,
      status: 'accepted'
    });
    await expect(service.markAssignmentPickedUp(actor, assignmentId)).resolves.toMatchObject({
      id: assignmentId,
      status: 'picked_up'
    });

    vi.mocked(repository.acceptAssignment).mockResolvedValueOnce({
      ...assignment,
      status: 'cancelled'
    });
    await expect(service.acceptAssignment(actor, assignmentId)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('transitions assigned delivery orders and records issues', async () => {
    await expect(service.markOrderOutForDelivery(actor, orderId)).resolves.toEqual(order);
    expect(repository.transitionAssignedOrderStatus).toHaveBeenCalledWith(
      riderId,
      orderId,
      'out_for_delivery',
      userId
    );

    await expect(
      service.createIssue(actor, orderId, {
        category: 'customer_unavailable',
        description: 'Customer did not answer.'
      })
    ).resolves.toEqual(issue);
  });

  it('returns earnings and settlements with date/cursor validation', async () => {
    const cursor = encodeCursor({ id: settlement.id, settlementDate: settlement.settlementDate });

    await expect(
      service.getEarnings(actor, {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30'
      })
    ).resolves.toEqual(earnings);

    await expect(
      service.listSettlements(actor, {
        cursor,
        limit: 10,
        status: 'draft'
      })
    ).resolves.toMatchObject({
      items: [settlement],
      pagination: { hasMore: false, limit: 10 }
    });

    expect(repository.listRiderSettlements).toHaveBeenCalledWith(riderId, {
      cursor: `${settlement.settlementDate}|${settlement.id}`,
      limit: 10,
      status: 'draft'
    });
  });

  it('rejects unauthorized, inactive, invalid, and missing rider access', async () => {
    await expect(service.listAssignments(customer, { limit: 20 })).rejects.toBeInstanceOf(
      ForbiddenException
    );

    vi.mocked(repository.findRiderProfileForActor).mockResolvedValueOnce({
      ...profile,
      active: false
    });
    await expect(service.listAssignments(actor, { limit: 20 })).rejects.toBeInstanceOf(
      ForbiddenException
    );

    vi.mocked(repository.findRiderProfileForActor).mockResolvedValueOnce(undefined);
    await expect(service.getProfile(actor)).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.listAssignments(actor, {
        cursor: 'not-a-cursor',
        limit: 20
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.getEarnings(actor, {
        dateFrom: '2026-06-30',
        dateTo: '2026-06-01'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
