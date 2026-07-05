import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { RidersService } from '../../src/modules/riders/riders.service.js';
import type {
  RiderAssignmentDetail,
  RiderAssignmentSummary,
  RiderEarningsSummary,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderProfile,
  RiderSettlementDetail,
  RiderSettlementSummary
} from '../../src/modules/riders/riders.types.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const settlementId = '66666666-6666-4666-8666-666666666666';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'rider' ? { rider_id: riderId } : {})
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

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
  serviceFeeKobo: 0,
  deliveryInstructions: 'Call at the gate.',
  deliveryMode: 'meal_direct_rider',
  specialInstructions: null,
  deliverySlotId: assignment.deliverySlotId,
  deliverySlotName: assignment.deliverySlotName,
  discountKobo: 0,
  largeOrderSurchargeKobo: 0,
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

const assignmentDetail: RiderAssignmentDetail = {
  ...assignment,
  orders: [order]
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

describe('rider API', () => {
  let app: NestFastifyApplication;
  let service: RidersService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = app.get(RidersService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a rider JWT for rider endpoints', async () => {
    const endpoints = [
      '/v1/rider/profile',
      '/v1/rider/assignments',
      `/v1/rider/assignments/${assignmentId}`,
      `/v1/rider/orders/${orderId}`,
      '/v1/rider/earnings',
      '/v1/rider/settlements'
    ];

    for (const url of endpoints) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('requires rider role for rider endpoints', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/rider/assignments',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates rider query, params, and payloads before invoking services', async () => {
    const token = await signToken('rider');

    const badAssignmentQuery = await app.inject({
      method: 'GET',
      url: '/v1/rider/assignments?date=15-06-2026&status=unknown',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badAssignmentQuery.statusCode).toBe(400);

    const badOrderParam = await app.inject({
      method: 'GET',
      url: '/v1/rider/orders/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badOrderParam.statusCode).toBe(400);

    const badIssuePayload = await app.inject({
      method: 'POST',
      url: `/v1/rider/orders/${orderId}/issues`,
      headers: { authorization: `Bearer ${token}` },
      payload: { category: 'refund', description: '' }
    });
    expect(badIssuePayload.statusCode).toBe(400);
  });

  it('returns rider profile, assignments, delivery flow, earnings, and settlements', async () => {
    const token = await signToken('rider');
    vi.spyOn(service, 'getProfile').mockResolvedValue(profile);
    vi.spyOn(service, 'updateProfile').mockResolvedValue(profile);
    vi.spyOn(service, 'setAvailability').mockResolvedValue({ ...profile, available: true });
    vi.spyOn(service, 'listAssignments').mockResolvedValue({
      items: [assignment],
      pagination: { hasMore: false, limit: 20 }
    });
    vi.spyOn(service, 'getAssignment').mockResolvedValue(assignmentDetail);
    vi.spyOn(service, 'acceptAssignment').mockResolvedValue({
      ...assignmentDetail,
      status: 'accepted'
    });
    vi.spyOn(service, 'markAssignmentPickedUp').mockResolvedValue({
      ...assignmentDetail,
      status: 'picked_up'
    });
    vi.spyOn(service, 'getOrder').mockResolvedValue(order);
    vi.spyOn(service, 'markOrderOutForDelivery').mockResolvedValue({
      ...order,
      orderStatus: 'out_for_delivery'
    });
    vi.spyOn(service, 'markOrderDelivered').mockResolvedValue({
      ...order,
      orderStatus: 'delivered'
    });
    vi.spyOn(service, 'createIssue').mockResolvedValue(issue);
    vi.spyOn(service, 'getEarnings').mockResolvedValue(earnings);
    vi.spyOn(service, 'listSettlements').mockResolvedValue({
      items: [settlement],
      pagination: { hasMore: false, limit: 20 }
    });
    vi.spyOn(service, 'getSettlement').mockResolvedValue(settlementDetail);

    const profileResponse = await app.inject({
      method: 'GET',
      url: '/v1/rider/profile',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json<{ data: RiderProfile }>().data.id).toBe(riderId);

    const availabilityResponse = await app.inject({
      method: 'PATCH',
      url: '/v1/rider/availability',
      headers: { authorization: `Bearer ${token}` },
      payload: { available: true }
    });
    expect(availabilityResponse.statusCode).toBe(200);
    expect(availabilityResponse.json<{ data: RiderProfile }>().data.available).toBe(true);

    const assignmentsResponse = await app.inject({
      method: 'GET',
      url: '/v1/rider/assignments?date=2026-06-15&status=assigned',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(assignmentsResponse.statusCode).toBe(200);
    expect(assignmentsResponse.json<{ data: RiderAssignmentSummary[] }>().data[0]?.id).toBe(
      assignmentId
    );

    const assignmentResponse = await app.inject({
      method: 'POST',
      url: `/v1/rider/assignments/${assignmentId}/accept`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(assignmentResponse.statusCode).toBe(200);
    expect(assignmentResponse.json<{ data: RiderAssignmentDetail }>().data.status).toBe('accepted');

    const orderResponse = await app.inject({
      method: 'POST',
      url: `/v1/rider/orders/${orderId}/out-for-delivery`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(orderResponse.statusCode).toBe(200);
    expect(orderResponse.json<{ data: RiderOrderDetail }>().data.orderStatus).toBe(
      'out_for_delivery'
    );

    const issueResponse = await app.inject({
      method: 'POST',
      url: `/v1/rider/orders/${orderId}/issues`,
      headers: { authorization: `Bearer ${token}` },
      payload: { category: 'customer_unavailable', description: 'Customer did not answer.' }
    });
    expect(issueResponse.statusCode).toBe(200);
    expect(issueResponse.json<{ data: RiderIssueRecord }>().data.id).toBe(issue.id);

    const earningsResponse = await app.inject({
      method: 'GET',
      url: '/v1/rider/earnings?dateFrom=2026-06-01&dateTo=2026-06-30',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(earningsResponse.statusCode).toBe(200);
    expect(earningsResponse.json<{ data: RiderEarningsSummary }>().data.totalAmountKobo).toBe(7500);

    const settlementResponse = await app.inject({
      method: 'GET',
      url: `/v1/rider/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(settlementResponse.statusCode).toBe(200);
    expect(settlementResponse.json<{ data: RiderSettlementDetail }>().data.id).toBe(settlementId);
  });
});
