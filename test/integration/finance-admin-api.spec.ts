import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { PaymentsService } from '../../src/modules/payments/payments.service.js';
import { ReconciliationService } from '../../src/modules/payments/reconciliation.service.js';
import { RefundsService } from '../../src/modules/payments/refunds.service.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const campusId = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';
const refundId = '44444444-4444-4444-8444-444444444444';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'campus_admin' ? { campus_id: campusId } : {})
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

describe('finance admin API (payments, refunds, reconciliation)', () => {
  let app: NestFastifyApplication;
  let payments: PaymentsService;
  let reconciliation: ReconciliationService;
  let refunds: RefundsService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    payments = app.get(PaymentsService);
    reconciliation = app.get(ReconciliationService);
    refunds = app.get(RefundsService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('rejects unauthenticated and non-admin actors on finance surfaces', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/v1/admin/payments' });
    expect(noToken.statusCode).toBe(401);

    const customer = await signToken('customer');
    for (const url of [
      '/v1/admin/payments',
      '/v1/admin/refunds',
      '/v1/admin/payments/reconciliation/issues'
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${customer}` }
      });
      expect(response.statusCode).toBe(403);
    }

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/admin/refunds/${refundId}/retry`,
      headers: { authorization: `Bearer ${customer}` }
    });
    expect(retry.statusCode).toBe(403);
  });

  it('serves finance surfaces to super admins', async () => {
    const token = await signToken('super_admin');

    vi.spyOn(payments, 'listAdminPayments').mockResolvedValue({
      items: [],
      hasMore: false,
      limit: 20
    });
    vi.spyOn(reconciliation, 'listIssues').mockResolvedValue({
      items: [],
      hasMore: false,
      limit: 20
    });
    vi.spyOn(refunds, 'listRefunds').mockResolvedValue({ items: [], hasMore: false, limit: 20 });
    vi.spyOn(refunds, 'retryRefund').mockResolvedValue({
      id: refundId,
      paymentId,
      orderId: '66666666-6666-4666-8666-666666666666',
      orderNumber: 'MD-0001',
      campusId,
      vendorId: null,
      customerId: null,
      customerEmail: null,
      providerReference: 'MD-0001',
      providerTransactionId: '4099260516',
      providerRefundReference: '3018284',
      amountKobo: 100000,
      reasonCode: 'customer_escalation',
      reasonText: null,
      status: 'succeeded',
      failureReason: null,
      resolutionNote: null,
      requestedBy: null,
      resolvedBy: userId,
      requestedAt: '2026-07-04T09:00:00.000Z',
      processedAt: '2026-07-04T09:05:00.000Z',
      updatedAt: '2026-07-04T09:05:00.000Z'
    });

    const list = await app.inject({
      method: 'GET',
      url: '/v1/admin/payments',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ data: [], pagination: { hasMore: false } });

    const issues = await app.inject({
      method: 'GET',
      url: '/v1/admin/payments/reconciliation/issues',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(issues.statusCode).toBe(200);

    const refundList = await app.inject({
      method: 'GET',
      url: '/v1/admin/refunds',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(refundList.statusCode).toBe(200);

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/admin/refunds/${refundId}/retry`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ data: { status: 'succeeded' } });
  });

  it('keeps rider payout surfaces off-limits to non-rider roles', async () => {
    const customer = await signToken('customer');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/rider/payout-account',
      headers: { authorization: `Bearer ${customer}` }
    });
    expect(response.statusCode).toBe(403);
  });
});
