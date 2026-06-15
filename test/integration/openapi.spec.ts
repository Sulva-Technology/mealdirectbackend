import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { createOpenApiDocument } from '../../src/openapi.js';

describe('OpenAPI contract foundation', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('documents health endpoints and auth schemes', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/health/live']).toBeDefined();
    expect(document.paths['/v1/health/ready']).toBeDefined();
    expect(document.components?.securitySchemes?.supabaseAuth).toBeDefined();
    expect(document.components?.securitySchemes?.idempotencyKey).toBeDefined();
  });

  it('registers shared API contract schemas', () => {
    const document = createOpenApiDocument(app);

    expect(document.components?.schemas?.CursorPaginationQueryDto).toBeDefined();
    expect(document.components?.schemas?.CursorPaginationMetaDto).toBeDefined();
    expect(document.components?.schemas?.MoneyDto).toBeDefined();
    expect(document.components?.schemas?.ErrorEnvelopeDto).toBeDefined();
    expect(document.components?.schemas?.ListEnvelopeDto).toBeDefined();
  });

  it('documents current-user profile and onboarding endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/me']).toBeDefined();
    expect(document.paths['/v1/me']?.get).toBeDefined();
    expect(document.paths['/v1/me']?.patch).toBeDefined();
    expect(document.paths['/v1/me/campuses']?.get).toBeDefined();
    expect(document.paths['/v1/me/complete-onboarding']?.post).toBeDefined();
    expect(document.paths['/v1/me/default-location']?.put).toBeDefined();
  });

  it('documents campus, location, zone, and delivery slot endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/campuses']?.get).toBeDefined();
    expect(document.paths['/v1/campuses/{campusId}/locations']?.get).toBeDefined();
    expect(document.paths['/v1/campuses/{campusId}/delivery-slots']?.get).toBeDefined();
    expect(document.paths['/v1/admin/campuses']?.get).toBeDefined();
    expect(document.paths['/v1/admin/campuses']?.post).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}']?.patch).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/zones']?.get).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/zones']?.post).toBeDefined();
    expect(document.paths['/v1/admin/zones/{zoneId}']?.patch).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/locations']?.get).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/locations']?.post).toBeDefined();
    expect(document.paths['/v1/admin/locations/{locationId}']?.patch).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/delivery-slots']?.get).toBeDefined();
    expect(document.paths['/v1/admin/campuses/{campusId}/delivery-slots']?.post).toBeDefined();
    expect(document.paths['/v1/admin/delivery-slots/{slotId}']?.patch).toBeDefined();
  });

  it('documents customer catalog endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/catalog/vendors']?.get).toBeDefined();
    expect(document.paths['/v1/catalog/vendors/{vendorId}']?.get).toBeDefined();
    expect(document.paths['/v1/catalog/vendors/{vendorId}/menu']?.get).toBeDefined();
  });

  it('documents customer order endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/orders/quote']?.post).toBeDefined();
    expect(document.paths['/v1/orders']?.post).toBeDefined();
    expect(document.paths['/v1/orders']?.get).toBeDefined();
    expect(document.paths['/v1/orders/{orderId}']?.get).toBeDefined();
    expect(document.paths['/v1/orders/{orderId}/payment-status']?.get).toBeDefined();
    expect(document.paths['/v1/orders/{orderId}/confirm-delivery']?.post).toBeDefined();
  });

  it('documents payment initialization, reconciliation, and refund endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/orders/{orderId}/payments/paystack/initialize']?.post).toBeDefined();
    expect(document.paths['/v1/admin/payments']?.get).toBeDefined();
    expect(document.paths['/v1/admin/payments/{paymentId}']?.get).toBeDefined();
    expect(document.paths['/v1/admin/payments/{paymentId}/reconcile']?.post).toBeDefined();
    expect(document.paths['/v1/admin/payments/{paymentId}/refunds']?.post).toBeDefined();
  });

  it('documents customer escalation and review endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/orders/{orderId}/escalations']?.get).toBeDefined();
    expect(document.paths['/v1/orders/{orderId}/escalations']?.post).toBeDefined();
    expect(document.paths['/v1/orders/{orderId}/review']?.post).toBeDefined();
  });

  it('documents notification endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/notifications']?.get).toBeDefined();
    expect(document.paths['/v1/notifications/{notificationId}/read']?.post).toBeDefined();
    expect(document.paths['/v1/notifications/read-all']?.post).toBeDefined();
    expect(document.paths['/v1/notifications/preferences']?.get).toBeDefined();
    expect(document.paths['/v1/notifications/preferences']?.put).toBeDefined();
  });

  it('documents vendor profile, payout, menu, and availability endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/vendor/profile']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/profile']?.patch).toBeDefined();
    expect(document.paths['/v1/vendor/payout-account']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/payout-account']?.put).toBeDefined();
    expect(document.paths['/v1/vendor/menu-metadata']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items']?.post).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}']?.patch).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}/activate']?.post).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}/deactivate']?.post).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}/schedules']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}/schedules']?.put).toBeDefined();
    expect(document.paths['/v1/vendor/availability']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/availability']?.put).toBeDefined();
    expect(document.paths['/v1/vendor/profile']?.patch?.requestBody).toBeDefined();
    expect(document.paths['/v1/vendor/payout-account']?.put?.requestBody).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items']?.post?.requestBody).toBeDefined();
    expect(document.paths['/v1/vendor/menu-items/{itemId}']?.patch?.requestBody).toBeDefined();
    expect(
      document.paths['/v1/vendor/menu-items/{itemId}/schedules']?.put?.requestBody
    ).toBeDefined();
    expect(document.paths['/v1/vendor/availability']?.put?.requestBody).toBeDefined();
  });

  it('documents vendor inventory endpoints', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/vendor/inventory']?.get).toBeDefined();
    expect(document.paths['/v1/vendor/inventory/{inventoryId}']?.put).toBeDefined();
    expect(document.paths['/v1/vendor/inventory/{inventoryId}/adjustments']?.post).toBeDefined();
    expect(document.paths['/v1/vendor/inventory/{inventoryId}']?.put?.requestBody).toBeDefined();
    expect(
      document.paths['/v1/vendor/inventory/{inventoryId}/adjustments']?.post?.requestBody
    ).toBeDefined();
  });
});
