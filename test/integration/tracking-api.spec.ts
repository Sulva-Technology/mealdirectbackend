import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { AdminPermissionsRepository } from '../../src/modules/auth/admin-permissions.repository.js';
import { TrackingService } from '../../src/modules/tracking/tracking.service.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const campusId = '22222222-2222-4222-8222-222222222222';
const riderId = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const locationId = '66666666-6666-4666-8666-666666666666';
const vendorId = '77777777-7777-4777-8777-777777777777';
const partnerId = '88888888-8888-4888-8888-888888888888';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'campus_admin' ? { campus_id: campusId } : {}),
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

describe('tracking API', () => {
  let app: NestFastifyApplication;
  let tracking: TrackingService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tracking = app.get(TrackingService);
    vi.spyOn(app.get(AdminPermissionsRepository), 'listActiveRoles').mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('requires a bearer token everywhere', async () => {
    for (const [method, url] of [
      ['PUT', '/v1/rider/location'],
      ['GET', `/v1/rider/assignments/${assignmentId}/route`],
      ['GET', `/v1/orders/${orderId}/tracking`],
      ['GET', '/v1/admin/map/riders'],
      ['GET', `/v1/fleet/partners/${partnerId}/map/riders`]
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('keeps each surface behind its role', async () => {
    const customer = await signToken('customer');
    const rider = await signToken('rider');

    const customerSharing = await app.inject({
      headers: { authorization: `Bearer ${customer}` },
      method: 'PUT',
      payload: { latitude: 7.62, longitude: 5.21 },
      url: '/v1/rider/location'
    });
    expect(customerSharing.statusCode).toBe(403);

    const riderReadingOrder = await app.inject({
      headers: { authorization: `Bearer ${rider}` },
      method: 'GET',
      url: `/v1/orders/${orderId}/tracking`
    });
    expect(riderReadingOrder.statusCode).toBe(403);

    const riderOnAdminMap = await app.inject({
      headers: { authorization: `Bearer ${rider}` },
      method: 'GET',
      url: '/v1/admin/map/riders'
    });
    expect(riderOnAdminMap.statusCode).toBe(403);
  });

  it('validates location fixes', async () => {
    const token = await signToken('rider');
    const headers = { authorization: `Bearer ${token}` };

    for (const payload of [
      { latitude: 91, longitude: 5 },
      { latitude: 7.6, longitude: 181 },
      { latitude: 'north', longitude: 5 },
      { latitude: 7.6, longitude: 5.2, headingDegrees: 360 },
      { latitude: 7.6, longitude: 5.2, recordedAt: 'yesterday' },
      { latitude: 7.6, longitude: 5.2, extra: true }
    ]) {
      const response = await app.inject({
        headers,
        method: 'PUT',
        payload,
        url: '/v1/rider/location'
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('stores a rider fix', async () => {
    const token = await signToken('rider');
    const record = vi
      .spyOn(tracking, 'recordRiderLocation')
      .mockResolvedValue({ accepted: true, recordedAt: '2026-10-15T12:00:00.000Z' });

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'PUT',
      payload: { accuracyMeters: 8, headingDegrees: 90, latitude: 7.62, longitude: 5.21 },
      url: '/v1/rider/location'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { accepted: true, recordedAt: '2026-10-15T12:00:00.000Z' }
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ riderId }), {
      accuracyMeters: 8,
      headingDegrees: 90,
      latitude: 7.62,
      longitude: 5.21
    });
  });

  it('serves the rider route and customer tracking', async () => {
    const riderToken = await signToken('rider');
    const customerToken = await signToken('customer');
    const getRoute = vi.spyOn(tracking, 'getRiderAssignmentRoute').mockResolvedValue({
      assignmentId,
      assignmentStatus: 'accepted',
      averageSpeedKmh: 15,
      computedAt: '2026-10-15T12:00:00.000Z',
      finalEtaAt: null,
      method: 'straight_line_estimate',
      origin: null,
      stops: [],
      totalDistanceMeters: null
    });
    const getTracking = vi.spyOn(tracking, 'getOrderTracking').mockResolvedValue({
      computedAt: '2026-10-15T12:00:00.000Z',
      destination: { latitude: 7.629, locationId, longitude: 5.22, name: 'Unity Hostel' },
      distanceMeters: 900,
      etaAt: '2026-10-15T12:05:00.000Z',
      etaMinutes: 5,
      method: 'straight_line_estimate',
      orderId,
      orderNumber: 'MD-1',
      orderStatus: 'out_for_delivery',
      phase: 'on_the_way',
      rider: {
        displayName: 'Chika',
        headingDegrees: 90,
        lastSeenAt: '2026-10-15T12:00:00.000Z',
        latitude: 7.62,
        longitude: 5.21,
        stale: false
      },
      stopsBeforeYou: 0
    });

    const route = await app.inject({
      headers: { authorization: `Bearer ${riderToken}` },
      method: 'GET',
      url: `/v1/rider/assignments/${assignmentId}/route`
    });
    expect(route.statusCode).toBe(200);
    expect(getRoute).toHaveBeenCalledWith(expect.objectContaining({ riderId }), assignmentId);

    const orderTracking = await app.inject({
      headers: { authorization: `Bearer ${customerToken}` },
      method: 'GET',
      url: `/v1/orders/${orderId}/tracking`
    });
    expect(orderTracking.statusCode).toBe(200);
    expect(orderTracking.json()).toMatchObject({ data: { etaMinutes: 5, phase: 'on_the_way' } });
    expect(getTracking).toHaveBeenCalledWith(expect.objectContaining({ userId }), orderId);

    const badOrder = await app.inject({
      headers: { authorization: `Bearer ${customerToken}` },
      method: 'GET',
      url: '/v1/orders/not-a-uuid/tracking'
    });
    expect(badOrder.statusCode).toBe(400);
  });

  it('sets and clears map pins as an admin', async () => {
    const token = await signToken('campus_admin');
    const headers = { authorization: `Bearer ${token}` };
    const setPoint = vi.spyOn(tracking, 'setPointCoordinates').mockResolvedValue({
      active: true,
      id: locationId,
      kind: 'location',
      latitude: 7.629,
      longitude: 5.22,
      name: 'Unity Hostel',
      zoneId: null
    });

    const invalid = await app.inject({
      headers,
      method: 'PUT',
      payload: { latitude: 7.629 },
      url: `/v1/admin/map/locations/${locationId}/coordinates`
    });
    expect(invalid.statusCode).toBe(400);

    const set = await app.inject({
      headers,
      method: 'PUT',
      payload: { latitude: 7.629, longitude: 5.22 },
      url: `/v1/admin/map/locations/${locationId}/coordinates`
    });
    expect(set.statusCode).toBe(200);
    expect(setPoint).toHaveBeenLastCalledWith(expect.anything(), 'location', locationId, {
      latitude: 7.629,
      longitude: 5.22
    });

    const clearVendor = await app.inject({
      headers,
      method: 'DELETE',
      url: `/v1/admin/map/vendors/${vendorId}/coordinates`
    });
    expect(clearVendor.statusCode).toBe(200);
    expect(setPoint).toHaveBeenLastCalledWith(expect.anything(), 'vendor', vendorId, null);
  });

  it('serves the admin and fleet rider maps', async () => {
    const admin = await signToken('campus_admin');
    const manager = await signToken('customer');
    const adminMap = vi.spyOn(tracking, 'listRidersForAdmin').mockResolvedValue([]);
    const fleetMap = vi.spyOn(tracking, 'listRidersForFleet').mockResolvedValue([]);

    const adminResponse = await app.inject({
      headers: { authorization: `Bearer ${admin}` },
      method: 'GET',
      url: `/v1/admin/map/riders?campusId=${campusId}`
    });
    expect(adminResponse.statusCode).toBe(200);
    expect(adminMap).toHaveBeenCalledWith(expect.anything(), campusId);

    const fleetResponse = await app.inject({
      headers: { authorization: `Bearer ${manager}` },
      method: 'GET',
      url: `/v1/fleet/partners/${partnerId}/map/riders`
    });
    expect(fleetResponse.statusCode).toBe(200);
    expect(fleetMap).toHaveBeenCalledWith(expect.objectContaining({ userId }), partnerId);
  });
});
