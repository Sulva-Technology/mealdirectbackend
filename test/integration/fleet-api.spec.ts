import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { AdminPermissionsRepository } from '../../src/modules/auth/admin-permissions.repository.js';
import { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';
import { FleetService } from '../../src/modules/fleet/fleet.service.js';
import type { FleetBatch, FleetPartner } from '../../src/modules/fleet/fleet.types.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const campusId = '22222222-2222-4222-8222-222222222222';
const partnerId = '33333333-3333-4333-8333-333333333333';
const riderId = '44444444-4444-4444-8444-444444444444';
const batchId = '55555555-5555-4555-8555-555555555555';

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

const partner: FleetPartner = {
  activeManagerCount: 1,
  campusId,
  campusName: 'Venite University',
  canDispatch: true,
  commissionBps: 1500,
  contactEmail: null,
  contactName: null,
  contactPhone: null,
  createdAt: '2026-10-15T09:00:00.000Z',
  dispatchPriority: 0,
  id: partnerId,
  joinCode: 'SWFT7K2Q',
  name: 'Swift Logistics',
  riderCount: 0,
  status: 'active',
  updatedAt: '2026-10-15T09:00:00.000Z'
};

const batch: FleetBatch = {
  assignmentId: '66666666-6666-4666-8666-666666666666',
  assignmentStatus: 'assigned',
  batchNumber: 'B-1',
  deliveryEarningsKobo: 7500,
  deliverySlotId: '77777777-7777-4777-8777-777777777777',
  deliverySlotName: 'Lunch',
  deliveryTime: '12:00:00',
  id: batchId,
  orderCount: 1,
  riderDisplayName: 'Ada Rider',
  riderId,
  serviceDate: '2026-10-15',
  status: 'assigned',
  vendorDisplayName: 'Ada Kitchen',
  vendorId: '88888888-8888-4888-8888-888888888888',
  zoneId: '99999999-9999-4999-8999-999999999999',
  zoneName: 'Zone A'
};

describe('fleet API', () => {
  let app: NestFastifyApplication;
  let fleet: FleetService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    fleet = app.get(FleetService);
    // No database in this suite: admins fall back to their coarse JWT role's permissions.
    vi.spyOn(app.get(AdminPermissionsRepository), 'listActiveRoles').mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('requires a bearer token on every fleet surface', async () => {
    for (const url of [
      '/v1/fleet/partners',
      `/v1/fleet/partners/${partnerId}`,
      '/v1/admin/fleet-partners',
      '/v1/rider/fleet'
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('keeps admin and rider fleet endpoints behind their roles', async () => {
    const customer = await signToken('customer');

    const adminList = await app.inject({
      headers: { authorization: `Bearer ${customer}` },
      method: 'GET',
      url: '/v1/admin/fleet-partners'
    });
    expect(adminList.statusCode).toBe(403);

    const riderJoin = await app.inject({
      headers: { authorization: `Bearer ${customer}` },
      method: 'POST',
      payload: { joinCode: 'SWFT7K2Q' },
      url: '/v1/rider/fleet/join'
    });
    expect(riderJoin.statusCode).toBe(403);
  });

  it('lets any signed-in account reach the fleet dashboard, gated by membership', async () => {
    const token = await signToken('customer');
    const listMyFleets = vi.spyOn(fleet, 'listMyFleets').mockResolvedValue([
      {
        campusId,
        campusName: 'Venite University',
        canDispatch: true,
        fleetPartnerId: partnerId,
        name: 'Swift Logistics',
        role: 'owner',
        status: 'active'
      }
    ]);

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/v1/fleet/partners'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ fleetPartnerId: partnerId, role: 'owner' }],
      pagination: { hasMore: false, limit: 1 }
    });
    expect(listMyFleets).toHaveBeenCalledWith(expect.objectContaining({ userId }));
  });

  it('validates fleet params, queries, and payloads before reaching the service', async () => {
    const token = await signToken('customer');
    const headers = { authorization: `Bearer ${token}` };

    const badParam = await app.inject({ headers, method: 'GET', url: '/v1/fleet/partners/nope' });
    expect(badParam.statusCode).toBe(400);

    const badDate = await app.inject({
      headers,
      method: 'GET',
      url: `/v1/fleet/partners/${partnerId}/batches?date=15-10-2026`
    });
    expect(badDate.statusCode).toBe(400);

    const badAvailable = await app.inject({
      headers,
      method: 'GET',
      url: `/v1/fleet/partners/${partnerId}/riders?available=maybe`
    });
    expect(badAvailable.statusCode).toBe(400);

    const badAssign = await app.inject({
      headers,
      method: 'POST',
      payload: { riderId: 'not-a-uuid' },
      url: `/v1/fleet/partners/${partnerId}/batches/${batchId}/assign`
    });
    expect(badAssign.statusCode).toBe(400);
  });

  it('dispatches a batch to a fleet rider', async () => {
    const token = await signToken('customer');
    const assignBatch = vi.spyOn(fleet, 'assignBatch').mockResolvedValue(batch);

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      payload: { riderId },
      url: `/v1/fleet/partners/${partnerId}/batches/${batchId}/assign`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: batchId, riderId } });
    expect(assignBatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      partnerId,
      batchId,
      riderId
    );
  });

  it('parses the riders availability filter', async () => {
    const token = await signToken('customer');
    const listFleetRiders = vi.spyOn(fleet, 'listFleetRiders').mockResolvedValue([]);

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: `/v1/fleet/partners/${partnerId}/riders?available=true&status=verified`
    });

    expect(response.statusCode).toBe(200);
    expect(listFleetRiders).toHaveBeenCalledWith(expect.anything(), partnerId, {
      available: true,
      status: 'verified'
    });
  });

  it('creates and updates fleet partners as an admin', async () => {
    const token = await signToken('campus_admin');
    const headers = { authorization: `Bearer ${token}` };
    const createPartner = vi.spyOn(fleet, 'createPartner').mockResolvedValue(partner);
    const updatePartner = vi
      .spyOn(fleet, 'updatePartner')
      .mockResolvedValue({ ...partner, status: 'suspended' });

    const invalid = await app.inject({
      headers,
      method: 'POST',
      payload: { campusId, commissionBps: 20000, name: 'S' },
      url: '/v1/admin/fleet-partners'
    });
    expect(invalid.statusCode).toBe(400);

    const created = await app.inject({
      headers,
      method: 'POST',
      payload: { campusId, commissionBps: 1500, name: 'Swift Logistics' },
      url: '/v1/admin/fleet-partners'
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ data: { joinCode: 'SWFT7K2Q' } });
    expect(createPartner).toHaveBeenCalledWith(expect.objectContaining({ campusId }), {
      campusId,
      commissionBps: 1500,
      name: 'Swift Logistics'
    });

    const nulledName = await app.inject({
      headers,
      method: 'PATCH',
      payload: { name: null },
      url: `/v1/admin/fleet-partners/${partnerId}`
    });
    expect(nulledName.statusCode).toBe(400);

    const suspended = await app.inject({
      headers,
      method: 'PATCH',
      payload: { contactName: null, status: 'suspended' },
      url: `/v1/admin/fleet-partners/${partnerId}`
    });
    expect(suspended.statusCode).toBe(200);
    expect(updatePartner).toHaveBeenCalledWith(expect.anything(), partnerId, {
      contactName: null,
      status: 'suspended'
    });
  });

  it('adds a fleet manager by email', async () => {
    const token = await signToken('super_admin');
    const addManager = vi.spyOn(fleet, 'addManager').mockResolvedValue({
      active: true,
      createdAt: '2026-10-15T09:00:00.000Z',
      displayName: null,
      email: 'tunde@swift.example',
      fleetPartnerId: partnerId,
      id: '66666666-6666-4666-8666-666666666666',
      invited: true,
      role: 'owner',
      userId
    });

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      payload: { email: 'tunde@swift.example', role: 'owner' },
      url: `/v1/admin/fleet-partners/${partnerId}/managers`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ data: { invited: true, role: 'owner' } });
    expect(addManager).toHaveBeenCalledWith(expect.anything(), partnerId, {
      email: 'tunde@swift.example',
      role: 'owner'
    });
  });

  it('lets a rider join and leave a fleet', async () => {
    const token = await signToken('rider');
    const headers = { authorization: `Bearer ${token}` };
    const joinFleet = vi.spyOn(fleet, 'joinFleet').mockResolvedValue({
      contactName: null,
      contactPhone: null,
      fleetPartnerId: partnerId,
      name: 'Swift Logistics',
      status: 'active'
    });
    vi.spyOn(fleet, 'leaveFleet').mockResolvedValue({ left: true });
    vi.spyOn(fleet, 'getRiderFleet').mockResolvedValue(null);

    const current = await app.inject({ headers, method: 'GET', url: '/v1/rider/fleet' });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({ data: null });

    const tooShort = await app.inject({
      headers,
      method: 'POST',
      payload: { joinCode: 'AB' },
      url: '/v1/rider/fleet/join'
    });
    expect(tooShort.statusCode).toBe(400);

    const joined = await app.inject({
      headers,
      method: 'POST',
      payload: { joinCode: 'swft-7k2q' },
      url: '/v1/rider/fleet/join'
    });
    expect(joined.statusCode).toBe(200);
    expect(joinFleet).toHaveBeenCalledWith(expect.objectContaining({ riderId }), 'swft-7k2q');

    const left = await app.inject({ headers, method: 'POST', url: '/v1/rider/fleet/leave' });
    expect(left.statusCode).toBe(200);
    expect(left.json()).toEqual({ data: { left: true } });
  });

  it('exposes a fleet login that defers to the auth service', async () => {
    const signIn = vi.spyOn(app.get(SupabaseAuthService), 'signInFleetManager').mockResolvedValue({
      accessToken: 'token',
      expiresIn: 3600,
      refreshToken: 'refresh',
      user: { email: 'tunde@swift.example', id: userId, role: 'customer' }
    });

    const response = await app.inject({
      method: 'POST',
      payload: { email: 'tunde@swift.example', password: 'Password123!' },
      url: '/v1/auth/fleet/login'
    });

    expect(response.statusCode).toBe(200);
    expect(signIn).toHaveBeenCalledWith('tunde@swift.example', 'Password123!');
  });
});
