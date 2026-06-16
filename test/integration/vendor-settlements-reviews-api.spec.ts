import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { ReviewsService } from '../../src/modules/reviews/reviews.service.js';
import { SettlementsService } from '../../src/modules/settlements/settlements.service.js';
import type { VendorReviewRecord } from '../../src/modules/reviews/reviews.types.js';
import type {
  SettlementDetail,
  SettlementSummary
} from '../../src/modules/settlements/settlements.types.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const vendorId = '11111111-1111-4111-8111-111111111111';
const settlementId = '44444444-4444-4444-8444-444444444444';
const menuItemId = '55555555-5555-4555-8555-555555555555';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'vendor' ? { vendor_id: vendorId } : {})
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('22222222-2222-4222-8222-222222222222')
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

const settlement: SettlementSummary = {
  adjustmentsKobo: 0,
  campusId: '66666666-6666-4666-8666-666666666666',
  createdAt: '2026-06-15T09:00:00.000Z',
  deliveryEarningsKobo: 50000,
  externalReference: null,
  grossFoodAmountKobo: 150000,
  id: settlementId,
  lineCount: 1,
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
      id: '77777777-7777-4777-8777-777777777777',
      lineType: 'food',
      orderId: '88888888-8888-4888-8888-888888888888',
      orderNumber: 'MD-1001',
      settlementId
    }
  ]
};

const review: VendorReviewRecord = {
  comment: 'Great food.',
  createdAt: '2026-06-15T09:00:00.000Z',
  deliveryBatchId: null,
  deliveryRating: null,
  foodRating: 5,
  id: '99999999-9999-4999-8999-999999999999',
  menuItemId,
  menuItemName: 'Jollof rice',
  moderationStatus: 'approved',
  orderId: '88888888-8888-4888-8888-888888888888',
  orderNumber: 'MD-1001',
  updatedAt: '2026-06-15T09:00:00.000Z',
  vendorId,
  vendorRating: 5
};

describe('vendor settlements and reviews API', () => {
  let app: NestFastifyApplication;
  let settlementsService: SettlementsService;
  let reviewsService: ReviewsService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    settlementsService = app.get(SettlementsService);
    reviewsService = app.get(ReviewsService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a vendor JWT for settlement and review read models', async () => {
    const endpoints = [
      '/v1/vendor/settlements',
      `/v1/vendor/settlements/${settlementId}`,
      '/v1/vendor/reviews'
    ];

    for (const url of endpoints) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('requires vendor role for settlement and review read models', async () => {
    const token = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/vendor/settlements',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates settlement and review filters before invoking services', async () => {
    const token = await signToken('vendor');

    const badSettlementDate = await app.inject({
      method: 'GET',
      url: '/v1/vendor/settlements?dateFrom=01-06-2026',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badSettlementDate.statusCode).toBe(400);

    const badSettlementId = await app.inject({
      method: 'GET',
      url: '/v1/vendor/settlements/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badSettlementId.statusCode).toBe(400);

    const badReviewFilter = await app.inject({
      method: 'GET',
      url: '/v1/vendor/reviews?menuItemId=not-a-uuid&rating=6',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badReviewFilter.statusCode).toBe(400);
  });

  it('returns vendor settlements, settlement detail, and reviews through envelopes', async () => {
    const token = await signToken('vendor');
    vi.spyOn(settlementsService, 'listVendorSettlements').mockResolvedValue({
      items: [settlement],
      pagination: { hasMore: false, limit: 20 }
    });
    vi.spyOn(settlementsService, 'getVendorSettlement').mockResolvedValue(settlementDetail);
    vi.spyOn(reviewsService, 'listVendorReviews').mockResolvedValue({
      items: [review],
      pagination: { hasMore: false, limit: 20 }
    });

    const listSettlements = await app.inject({
      method: 'GET',
      url: '/v1/vendor/settlements?dateFrom=2026-06-01&dateTo=2026-06-30',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listSettlements.statusCode).toBe(200);
    const settlementListJson = listSettlements.json<{ data: SettlementSummary[] }>();
    expect(settlementListJson.data[0]).toMatchObject({ id: settlementId });

    const getSettlement = await app.inject({
      method: 'GET',
      url: `/v1/vendor/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(getSettlement.statusCode).toBe(200);
    const settlementDetailJson = getSettlement.json<{ data: SettlementDetail }>();
    expect(settlementDetailJson.data.lines[0]).toMatchObject({ lineType: 'food' });

    const listReviews = await app.inject({
      method: 'GET',
      url: `/v1/vendor/reviews?menuItemId=${menuItemId}&rating=5`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listReviews.statusCode).toBe(200);
    const reviewsJson = listReviews.json<{
      data: (VendorReviewRecord & { reviewerId?: string })[];
    }>();
    const firstReview = reviewsJson.data[0];
    expect(firstReview).toBeDefined();
    expect(firstReview).toMatchObject({ id: review.id });
    expect(firstReview?.reviewerId).toBeUndefined();
  });
});
