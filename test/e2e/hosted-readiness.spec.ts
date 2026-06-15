import { createHmac } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Pool } from 'pg';

import { createApp } from '../../src/app.factory.js';
import { authHeader } from './helpers/auth.js';
import { cleanupOrders, createE2EPool } from './helpers/db.js';
import { startFakePaystack, type FakePaystackServer } from './helpers/fake-paystack.js';
import { fixtures } from './helpers/fixtures.js';

type CreatedOrderResponse = {
  orderId: string;
};

type Envelope<T> = {
  data: T;
};

function serviceDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function e2eNamespace(): string {
  const value = process.env.E2E_TEST_NAMESPACE;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('E2E_TEST_NAMESPACE is required for hosted E2E records.');
  }
  return value;
}

function orderPayload(): Record<string, unknown> {
  return {
    campusId: fixtures.campusId,
    deliveryMode: 'meal_direct_rider',
    deliverySlotId: fixtures.slotId,
    items: [{ menuItemId: fixtures.menuItemId, quantity: 1 }],
    locationId: fixtures.locationId,
    serviceDate: serviceDate(),
    vendorId: fixtures.vendorId
  };
}

function signPaystackPayload(rawBody: string): string {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (secret === undefined) {
    throw new Error('PAYSTACK_SECRET_KEY is required for E2E webhook signing.');
  }
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

describe('hosted Supabase production-readiness E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let paystack: FakePaystackServer;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    paystack = await startFakePaystack();
    expect(paystack.baseUrl).toBe(process.env.PAYSTACK_BASE_URL);
    pool = createE2EPool();
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await cleanupOrders(pool, createdOrderIds.splice(0));
  });

  afterAll(async () => {
    await app.close();
    await paystack.close();
    await pool.end();
  });

  it('proves customer catalog, order, Paystack initialization, webhook, and notification flow', async () => {
    const customerHeaders = await authHeader('customer');

    const me = await app.inject({
      headers: customerHeaders,
      method: 'GET',
      url: '/v1/me'
    });
    expect(me.statusCode).toBe(200);

    const catalog = await app.inject({
      method: 'GET',
      url: `/v1/catalog/vendors?campusId=${fixtures.campusId}&date=${serviceDate()}&slotId=${fixtures.slotId}&locationId=${fixtures.locationId}`
    });
    expect(catalog.statusCode).toBe(200);

    const quote = await app.inject({
      headers: customerHeaders,
      method: 'POST',
      payload: orderPayload(),
      url: '/v1/orders/quote'
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json<Envelope<{ totalKobo: number }>>().data.totalKobo).toBeGreaterThan(0);

    const idempotencyKey = `${e2eNamespace()}-order-${String(Date.now())}`;
    const created = await app.inject({
      headers: {
        ...customerHeaders,
        'idempotency-key': idempotencyKey
      },
      method: 'POST',
      payload: orderPayload(),
      url: '/v1/orders'
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json<CreatedOrderResponse>().orderId;
    createdOrderIds.push(orderId);

    const duplicate = await app.inject({
      headers: {
        ...customerHeaders,
        'idempotency-key': idempotencyKey
      },
      method: 'POST',
      payload: orderPayload(),
      url: '/v1/orders'
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json<CreatedOrderResponse>().orderId).toBe(orderId);

    const initialized = await app.inject({
      headers: customerHeaders,
      method: 'POST',
      url: `/v1/orders/${orderId}/payments/paystack/initialize`
    });
    expect(initialized.statusCode).toBe(200);
    const payment = initialized.json<Envelope<{ paymentId: string; reference: string }>>().data;
    expect(payment.reference).toMatch(/^MD-/);

    const webhookPayload = {
      data: {
        amount: 95000,
        currency: 'NGN',
        id: 123456789,
        reference: payment.reference,
        status: 'success'
      },
      event: 'charge.success'
    };
    const rawBody = JSON.stringify(webhookPayload);
    const webhookHeaders = {
      'content-type': 'application/json',
      'x-paystack-signature': signPaystackPayload(rawBody)
    };

    const webhook = await app.inject({
      headers: webhookHeaders,
      method: 'POST',
      payload: rawBody,
      url: '/v1/payments/webhooks/paystack'
    });
    expect(webhook.statusCode).toBe(202);

    const duplicateWebhook = await app.inject({
      headers: webhookHeaders,
      method: 'POST',
      payload: rawBody,
      url: '/v1/payments/webhooks/paystack'
    });
    expect(duplicateWebhook.statusCode).toBe(200);

    const paymentStatus = await app.inject({
      headers: customerHeaders,
      method: 'GET',
      url: `/v1/orders/${orderId}/payment-status`
    });
    expect(paymentStatus.statusCode).toBe(200);
    expect(
      paymentStatus.json<Envelope<{ payment: { paymentStatus: string } }>>().data.payment
        .paymentStatus
    ).toBe('successful');

    const notifications = await app.inject({
      headers: customerHeaders,
      method: 'GET',
      url: '/v1/notifications'
    });
    expect(notifications.statusCode).toBe(200);
  });

  it('proves vendor, rider, admin, settlement, and outbox read surfaces against Supabase', async () => {
    const vendorHeaders = await authHeader('vendor');
    const riderHeaders = await authHeader('rider');
    const adminHeaders = await authHeader('campus_admin');
    const superAdminHeaders = await authHeader('super_admin');

    const vendorProfile = await app.inject({
      headers: vendorHeaders,
      method: 'GET',
      url: '/v1/vendor/profile'
    });
    expect(vendorProfile.statusCode).toBe(200);

    const vendorOrders = await app.inject({
      headers: vendorHeaders,
      method: 'GET',
      url: `/v1/vendor/orders?date=${serviceDate()}`
    });
    expect(vendorOrders.statusCode).toBe(200);

    const vendorBatches = await app.inject({
      headers: vendorHeaders,
      method: 'GET',
      url: `/v1/vendor/batches?date=${serviceDate()}`
    });
    expect(vendorBatches.statusCode).toBe(200);

    const riderAssignments = await app.inject({
      headers: riderHeaders,
      method: 'GET',
      url: `/v1/rider/assignments?date=${serviceDate()}`
    });
    expect(riderAssignments.statusCode).toBe(200);

    const riderEarnings = await app.inject({
      headers: riderHeaders,
      method: 'GET',
      url: `/v1/rider/earnings?dateFrom=${serviceDate()}&dateTo=${serviceDate()}`
    });
    expect(riderEarnings.statusCode).toBe(200);

    const adminDashboard = await app.inject({
      headers: adminHeaders,
      method: 'GET',
      url: `/v1/admin/dashboard?date=${serviceDate()}`
    });
    expect(adminDashboard.statusCode).toBe(200);

    const settlementPreview = await app.inject({
      headers: adminHeaders,
      method: 'POST',
      payload: {
        beneficiaryId: fixtures.vendorId,
        beneficiaryType: 'vendor',
        settlementDate: serviceDate()
      },
      url: '/v1/admin/settlements/preview'
    });
    expect(settlementPreview.statusCode).toBe(200);

    const adminPayments = await app.inject({
      headers: adminHeaders,
      method: 'GET',
      url: '/v1/admin/payments'
    });
    expect(adminPayments.statusCode).toBe(200);

    const refund = await app.inject({
      headers: adminHeaders,
      method: 'POST',
      payload: {
        amountKobo: 1000,
        reasonCode: 'e2e_small_refund',
        reasonText: 'Hosted E2E fake Paystack refund.'
      },
      url: `/v1/admin/payments/${fixtures.paymentId}/refunds`
    });
    expect(refund.statusCode).toBeLessThan(500);

    const auditLogs = await app.inject({
      headers: superAdminHeaders,
      method: 'GET',
      url: '/v1/admin/audit-logs'
    });
    expect(auditLogs.statusCode).toBe(200);

    const outbox = await app.inject({
      headers: adminHeaders,
      method: 'GET',
      url: '/v1/admin/jobs/outbox?limit=5'
    });
    expect(outbox.statusCode).toBe(200);
  });

  it('proves critical failure paths stay bounded', async () => {
    const customerHeaders = await authHeader('customer');
    const adminHeaders = await authHeader('campus_admin');

    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/admin/session' });
    expect(unauthenticated.statusCode).toBe(401);

    const wrongRole = await app.inject({
      headers: customerHeaders,
      method: 'GET',
      url: '/v1/admin/orders'
    });
    expect(wrongRole.statusCode).toBe(403);

    const crossCampus = await app.inject({
      headers: adminHeaders,
      method: 'GET',
      url: `/v1/admin/orders?campusId=${fixtures.crossCampusId}`
    });
    expect(crossCampus.statusCode).toBe(403);

    const unsignedWebhook = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: '{}',
      url: '/v1/payments/webhooks/paystack'
    });
    expect(unsignedWebhook.statusCode).toBe(401);

    const overRefund = await app.inject({
      headers: adminHeaders,
      method: 'POST',
      payload: {
        amountKobo: 999999999,
        reasonCode: 'e2e_over_refund'
      },
      url: `/v1/admin/payments/${fixtures.paymentId}/refunds`
    });
    expect(overRefund.statusCode).toBe(400);
  });
});
