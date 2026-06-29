import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import { JobsService } from '../../src/modules/jobs/jobs.service.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const campusId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';
const vendorId = '55555555-5555-4555-8555-555555555555';
const riderId = '66666666-6666-4666-8666-666666666666';
const settlementId = '77777777-7777-4777-8777-777777777777';

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

describe('admin API', () => {
  let app: NestFastifyApplication;
  let admin: AdminService;
  let jobs: JobsService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    admin = app.get(AdminService);
    jobs = app.get(JobsService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('requires admin JWTs for admin surfaces', async () => {
    const missingToken = await app.inject({ method: 'GET', url: '/v1/admin/session' });
    expect(missingToken.statusCode).toBe(401);

    const token = await signToken('customer');
    const wrongRole = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(wrongRole.statusCode).toBe(403);
  });

  it('validates representative admin params, queries, and payloads', async () => {
    const token = await signToken('campus_admin');

    const badOrderStatus = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders?status=unknown',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badOrderStatus.statusCode).toBe(400);

    const badOrderParam = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badOrderParam.statusCode).toBe(400);

    const badOutboxStatus = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/outbox?status=unknown',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badOutboxStatus.statusCode).toBe(400);

    const badProcessPayload = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/outbox/process',
      headers: { authorization: `Bearer ${token}` },
      payload: { limit: 99 }
    });
    expect(badProcessPayload.statusCode).toBe(400);
  });

  it('serves representative module 16-21 admin endpoints', async () => {
    const token = await signToken('campus_admin');
    const record = { id: orderId, campusId };

    vi.spyOn(admin, 'getDashboard').mockResolvedValue({
      alerts: [],
      batches: {},
      campusId,
      date: '2026-06-15',
      escalations: {},
      orders: { total: 1 },
      payments: {},
      settlements: {}
    });
    vi.spyOn(admin, 'listOrders').mockResolvedValue({
      hasMore: false,
      items: [record],
      limit: 20
    });
    vi.spyOn(admin, 'transitionOrder').mockResolvedValue({ ...record, orderStatus: 'ready' });
    vi.spyOn(admin, 'assignBatch').mockResolvedValue({ id: batchId, riderId });
    vi.spyOn(admin, 'setVendorStatus').mockResolvedValue({ id: vendorId, status: 'approved' });
    vi.spyOn(admin, 'createVendorInvitation').mockResolvedValue({
      acceptedAt: null,
      acceptedByUserId: null,
      createdByAdminId: userId,
      createdAt: '2026-06-29T09:00:00.000Z',
      email: 'owner@example.com',
      expiresAt: '2026-06-30T09:00:00.000Z',
      id: '99999999-9999-4999-8999-999999999999',
      inviteUrl: 'https://vendor.mealdirectly.com/accept-invite?token=mock-token',
      revokedAt: null,
      vendorId
    });
    vi.spyOn(admin, 'setRiderStatus').mockResolvedValue({ id: riderId, status: 'verified' });
    vi.spyOn(admin, 'previewSettlement').mockResolvedValue({
      beneficiaryId: vendorId,
      beneficiaryType: 'vendor',
      estimatedPayableKobo: 250000,
      settlementDate: '2026-06-15'
    });
    vi.spyOn(admin, 'approveSettlement').mockResolvedValue({
      id: settlementId,
      status: 'approved'
    });
    vi.spyOn(jobs, 'getSystemSummary').mockResolvedValue({
      databaseTime: '2026-06-15T09:00:00.000Z',
      outbox: { available: 1 },
      worker: { registeredQueues: ['outbox_events'] }
    });
    vi.spyOn(jobs, 'listOutboxEvents').mockResolvedValue([
      { eventType: 'order.ready', id: '88888888-8888-4888-8888-888888888888' }
    ]);
    vi.spyOn(jobs, 'claimAvailableOutboxEvents').mockResolvedValue({
      claimedCount: 1,
      events: [{ id: '88888888-8888-4888-8888-888888888888' }],
      workerId: 'admin-worker'
    });

    const session = await app.inject({
      method: 'GET',
      url: '/v1/admin/session',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(session.statusCode).toBe(200);
    expect(session.json<{ data: { campusId: string; role: string } }>().data).toMatchObject({
      campusId,
      role: 'campus_admin'
    });

    const dashboard = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard?date=2026-06-15',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json<{ data: { orders: { total: number } } }>().data.orders.total).toBe(1);

    const orders = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(orders.statusCode).toBe(200);
    expect(orders.json<{ data: { id: string }[] }>().data[0]?.id).toBe(orderId);

    const transition = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/status-transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'ready', reason: 'Kitchen finished early.' }
    });
    expect(transition.statusCode).toBe(200);

    const assignBatch = await app.inject({
      method: 'POST',
      url: `/v1/admin/batches/${batchId}/assign-rider`,
      headers: { authorization: `Bearer ${token}` },
      payload: { riderId }
    });
    expect(assignBatch.statusCode).toBe(200);
    expect(assignBatch.json<{ data: { riderId: string } }>().data.riderId).toBe(riderId);

    const approveVendor = await app.inject({
      method: 'POST',
      url: `/v1/admin/vendors/${vendorId}/approve`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(approveVendor.statusCode).toBe(200);

    const vendorInvite = await app.inject({
      method: 'POST',
      url: `/v1/admin/vendors/${vendorId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'owner@example.com', expiresInHours: 24 }
    });
    expect(vendorInvite.statusCode).toBe(201);
    expect(vendorInvite.json<{ data: { inviteUrl: string } }>().data.inviteUrl).toContain(
      '/accept-invite?token='
    );

    const verifyRider = await app.inject({
      method: 'POST',
      url: `/v1/admin/riders/${riderId}/verify`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(verifyRider.statusCode).toBe(200);

    const settlementPreview = await app.inject({
      method: 'POST',
      url: '/v1/admin/settlements/preview',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        beneficiaryId: vendorId,
        beneficiaryType: 'vendor',
        settlementDate: '2026-06-15'
      }
    });
    expect(settlementPreview.statusCode).toBe(200);
    expect(
      settlementPreview.json<{ data: { estimatedPayableKobo: number } }>().data.estimatedPayableKobo
    ).toBe(250000);

    const approveSettlement = await app.inject({
      method: 'POST',
      url: `/v1/admin/settlements/${settlementId}/approve`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(approveSettlement.statusCode).toBe(200);

    const system = await app.inject({
      method: 'GET',
      url: '/v1/admin/system',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(system.statusCode).toBe(200);
    expect(
      system.json<{ data: { worker: { registeredQueues: string[] } } }>().data.worker
        .registeredQueues
    ).toContain('outbox_events');

    const outbox = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/outbox?status=available',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(outbox.statusCode).toBe(200);
    expect(outbox.json<{ data: { eventType: string }[] }>().data[0]?.eventType).toBe('order.ready');

    const process = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/outbox/process',
      headers: { authorization: `Bearer ${token}` },
      payload: { limit: 1, workerId: 'admin-worker' }
    });
    expect(process.statusCode).toBe(200);
    expect(process.json<{ data: { claimedCount: number } }>().data.claimedCount).toBe(1);
  });
});
