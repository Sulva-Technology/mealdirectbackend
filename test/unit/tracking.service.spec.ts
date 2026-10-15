import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvService } from '../../src/config/env.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { FleetService } from '../../src/modules/fleet/fleet.service.js';
import type { TrackingRepository } from '../../src/modules/tracking/tracking.repository.js';
import {
  TrackingService,
  buildDropoffStops,
  isFresh,
  trackingPhase
} from '../../src/modules/tracking/tracking.service.js';
import type {
  OrderTrackingContext,
  StoredRiderLocation,
  TrackingAssignment,
  TrackingDropoffOrder,
  TrackingRider
} from '../../src/modules/tracking/tracking.types.js';

const now = new Date('2026-10-15T12:00:00.000Z');
const campusId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const orderA = '44444444-4444-4444-8444-44444444444a';
const orderB = '44444444-4444-4444-8444-44444444444b';
const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

const rider: AuthenticatedActor = {
  riderId,
  role: 'rider',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
};
const customer: AuthenticatedActor = { role: 'customer', userId: customerId };
const campusAdmin: AuthenticatedActor = {
  campusId,
  role: 'campus_admin',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
};

function riderRow(overrides: Partial<TrackingRider> = {}): TrackingRider {
  return {
    active: true,
    available: true,
    campusId,
    displayName: 'Chika Okafor',
    id: riderId,
    openAssignmentCount: 0,
    status: 'verified',
    ...overrides
  };
}

function assignment(overrides: Partial<TrackingAssignment> = {}): TrackingAssignment {
  return {
    batchId: '55555555-5555-4555-8555-555555555555',
    id: assignmentId,
    riderId,
    status: 'accepted',
    vendorId: '66666666-6666-4666-8666-666666666666',
    vendorLatitude: 7.625,
    vendorLongitude: 5.22,
    vendorName: 'Alliday Cafeteria',
    ...overrides
  };
}

function dropoff(
  orderId: string,
  locationId: string,
  latitude: number | null
): TrackingDropoffOrder {
  return {
    latitude,
    locationId,
    locationName: `Location ${locationId.slice(-1)}`,
    longitude: latitude === null ? null : 5.22,
    orderId,
    orderNumber: `MD-${orderId.slice(-1)}`,
    orderStatus: 'out_for_delivery'
  };
}

function location(recordedAt = now.toISOString()): StoredRiderLocation {
  return {
    accuracyMeters: 8,
    headingDegrees: 90,
    latitude: 7.62,
    longitude: 5.215,
    receivedAt: recordedAt,
    recordedAt,
    riderId,
    speedMps: null
  };
}

function trackingContext(overrides: Partial<OrderTrackingContext> = {}): OrderTrackingContext {
  return {
    assignmentId,
    assignmentStatus: 'picked_up',
    deliveryMode: 'meal_direct_rider',
    latitude: 7.629,
    locationId: '77777777-7777-4777-8777-77777777777a',
    locationName: 'Unity Hostel',
    longitude: 5.22,
    orderId: orderA,
    orderNumber: 'MD-a',
    orderStatus: 'out_for_delivery',
    riderDisplayName: 'Chika Okafor',
    riderId,
    ...overrides
  };
}

function repositoryMock() {
  return {
    deleteRiderLocation: vi.fn().mockResolvedValue(undefined),
    findAssignment: vi.fn().mockResolvedValue(assignment()),
    findOrderTrackingContext: vi.fn().mockResolvedValue(trackingContext()),
    findPointCampus: vi.fn().mockResolvedValue(campusId),
    findRiderForUser: vi.fn().mockResolvedValue(riderRow()),
    getRiderLocation: vi.fn().mockResolvedValue(location()),
    listMapPoints: vi.fn().mockResolvedValue([
      {
        active: true,
        id: '77777777-7777-4777-8777-77777777777a',
        kind: 'location',
        latitude: 7.629,
        longitude: 5.22,
        name: 'Unity Hostel',
        zoneId: null
      }
    ]),
    listOpenDropoffs: vi.fn().mockResolvedValue([]),
    listRiderPositions: vi.fn().mockResolvedValue([]),
    setPointCoordinates: vi.fn().mockResolvedValue(undefined),
    upsertRiderLocation: vi.fn().mockResolvedValue(true)
  };
}

describe('tracking helpers', () => {
  it.each([
    ['pending_payment', null, 'awaiting_payment'],
    ['paid', 'accepted', 'preparing'],
    ['ready', 'accepted', 'awaiting_pickup'],
    ['ready', 'picked_up', 'on_the_way'],
    ['out_for_delivery', 'picked_up', 'on_the_way'],
    ['delivered', 'completed', 'delivered'],
    ['refunded', null, 'closed']
  ])('maps %s/%s to %s', (orderStatus, assignmentStatus, phase) => {
    expect(trackingPhase(orderStatus, assignmentStatus)).toBe(phase);
  });

  it('groups orders into one drop-off per location', () => {
    const stops = buildDropoffStops([
      dropoff(orderA, 'loc-1', 7.62),
      dropoff(orderB, 'loc-1', 7.62),
      dropoff('order-c', 'loc-2', null)
    ]);
    expect(
      stops.map((stop) => [stop.locationId, stop.orderIds.length, stop.point === null])
    ).toEqual([
      ['loc-1', 2, false],
      ['loc-2', 1, true]
    ]);
  });

  it('treats fixes older than five minutes as stale', () => {
    expect(isFresh(new Date(now.getTime() - 299_000).toISOString(), now)).toBe(true);
    expect(isFresh(new Date(now.getTime() - 301_000).toISOString(), now)).toBe(false);
  });
});

describe('TrackingService', () => {
  let repository: ReturnType<typeof repositoryMock>;
  let fleet: { requireManagedFleet: ReturnType<typeof vi.fn> };
  let service: TrackingService;

  beforeEach(() => {
    repository = repositoryMock();
    fleet = {
      requireManagedFleet: vi.fn().mockResolvedValue({ campusId, id: 'fleet-1' })
    };
    const env = { get: vi.fn().mockReturnValue(15) } as unknown as EnvService;
    service = new TrackingService(
      repository as unknown as TrackingRepository,
      fleet as unknown as FleetService,
      env
    );
  });

  describe('rider location', () => {
    it('stores a fix from an on-shift rider, defaulting the time to now', async () => {
      await expect(
        service.recordRiderLocation(rider, { latitude: 7.62, longitude: 5.21 }, now)
      ).resolves.toEqual({ accepted: true, recordedAt: now.toISOString() });
      expect(repository.upsertRiderLocation).toHaveBeenCalledWith(riderId, {
        latitude: 7.62,
        longitude: 5.21,
        recordedAt: now.toISOString()
      });
    });

    it('lets an off-shift rider share while a delivery is open', async () => {
      repository.findRiderForUser.mockResolvedValue(
        riderRow({ available: false, openAssignmentCount: 1 })
      );
      await expect(
        service.recordRiderLocation(rider, { latitude: 7.62, longitude: 5.21 }, now)
      ).resolves.toMatchObject({ accepted: true });
    });

    it('refuses a rider who is off shift with nothing to deliver', async () => {
      repository.findRiderForUser.mockResolvedValue(riderRow({ available: false }));
      await expect(
        service.recordRiderLocation(rider, { latitude: 7.62, longitude: 5.21 }, now)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.upsertRiderLocation).not.toHaveBeenCalled();
    });

    it('refuses unverified or inactive riders', async () => {
      repository.findRiderForUser.mockResolvedValue(riderRow({ status: 'pending' }));
      await expect(
        service.recordRiderLocation(rider, { latitude: 7.62, longitude: 5.21 }, now)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects fixes from the future and drops very old ones quietly', async () => {
      await expect(
        service.recordRiderLocation(
          rider,
          { latitude: 7.62, longitude: 5.21, recordedAt: '2026-10-15T12:05:00.000Z' },
          now
        )
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.recordRiderLocation(
          rider,
          { latitude: 7.62, longitude: 5.21, recordedAt: '2026-10-15T11:30:00.000Z' },
          now
        )
      ).resolves.toEqual({ accepted: false, recordedAt: '2026-10-15T11:30:00.000Z' });
      expect(repository.upsertRiderLocation).not.toHaveBeenCalled();
    });

    it('requires a rider profile', async () => {
      repository.findRiderForUser.mockResolvedValue(undefined);
      await expect(service.stopSharingLocation(rider)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assignment route', () => {
    it('goes to the vendor first, then the nearest drop-off', async () => {
      repository.listOpenDropoffs.mockResolvedValue([
        dropoff(orderA, '77777777-7777-4777-8777-77777777777a', 7.64),
        dropoff(orderB, '77777777-7777-4777-8777-77777777777b', 7.627)
      ]);

      const route = await service.getRiderAssignmentRoute(rider, assignmentId, now);

      expect(route.stops.map((stop) => [stop.type, stop.name])).toEqual([
        ['pickup', 'Alliday Cafeteria'],
        ['dropoff', 'Location b'],
        ['dropoff', 'Location a']
      ]);
      expect(route.stops.every((stop) => stop.etaAt !== null)).toBe(true);
      expect(route.origin).toEqual({
        latitude: 7.62,
        longitude: 5.215,
        recordedAt: now.toISOString()
      });
      expect(route.averageSpeedKmh).toBe(15);
    });

    it('skips the pickup once the batch is picked up', async () => {
      repository.findAssignment.mockResolvedValue(assignment({ status: 'picked_up' }));
      repository.listOpenDropoffs.mockResolvedValue([dropoff(orderA, 'loc-a', 7.629)]);

      const route = await service.getRiderAssignmentRoute(rider, assignmentId, now);
      expect(route.stops.map((stop) => stop.type)).toEqual(['dropoff']);
    });

    it('gives stops but no ETAs when the rider position is stale', async () => {
      repository.getRiderLocation.mockResolvedValue(location('2026-10-15T11:50:00.000Z'));
      repository.listOpenDropoffs.mockResolvedValue([dropoff(orderA, 'loc-a', 7.629)]);

      const route = await service.getRiderAssignmentRoute(rider, assignmentId, now);
      expect(route.origin).toBeNull();
      expect(route.stops.map((stop) => stop.etaAt)).toEqual([null, null]);
    });

    it('returns an empty route for a finished assignment', async () => {
      repository.findAssignment.mockResolvedValue(assignment({ status: 'completed' }));
      const route = await service.getRiderAssignmentRoute(rider, assignmentId, now);
      expect(route.stops).toEqual([]);
      expect(repository.listOpenDropoffs).not.toHaveBeenCalled();
    });

    it("hides another rider's assignment", async () => {
      repository.findAssignment.mockResolvedValue(assignment({ riderId: 'someone-else' }));
      await expect(
        service.getRiderAssignmentRoute(rider, assignmentId, now)
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('customer order tracking', () => {
    it('shows the rider first name, position, and ETA while on the way', async () => {
      repository.findAssignment.mockResolvedValue(assignment({ status: 'picked_up' }));
      repository.listOpenDropoffs.mockResolvedValue([
        dropoff(orderB, '77777777-7777-4777-8777-77777777777b', 7.625),
        dropoff(orderA, '77777777-7777-4777-8777-77777777777a', 7.64)
      ]);

      const tracking = await service.getOrderTracking(customer, orderA, now);

      expect(repository.findOrderTrackingContext).toHaveBeenCalledWith(orderA, customerId);
      expect(tracking.phase).toBe('on_the_way');
      expect(tracking.rider).toMatchObject({
        displayName: 'Chika',
        latitude: 7.62,
        longitude: 5.215,
        stale: false
      });
      expect(tracking.stopsBeforeYou).toBe(1);
      expect(tracking.etaAt).not.toBeNull();
      expect(tracking.distanceMeters).toBeGreaterThan(0);
    });

    it('gives an ETA but no rider position before pickup', async () => {
      repository.findOrderTrackingContext.mockResolvedValue(
        trackingContext({ assignmentStatus: 'accepted', orderStatus: 'ready' })
      );
      repository.listOpenDropoffs.mockResolvedValue([
        dropoff(orderA, '77777777-7777-4777-8777-77777777777a', 7.629)
      ]);

      const tracking = await service.getOrderTracking(customer, orderA, now);
      expect(tracking.phase).toBe('awaiting_pickup');
      expect(tracking.rider).toBeNull();
      expect(tracking.etaMinutes).not.toBeNull();
    });

    it('does not compute a route for orders that are not moving', async () => {
      repository.findOrderTrackingContext.mockResolvedValue(
        trackingContext({ orderStatus: 'paid' })
      );
      const tracking = await service.getOrderTracking(customer, orderA, now);
      expect(tracking).toMatchObject({ etaAt: null, phase: 'preparing', rider: null });
      expect(repository.findAssignment).not.toHaveBeenCalled();
    });

    it('has nothing to track for vendor-delivered orders', async () => {
      repository.findOrderTrackingContext.mockResolvedValue(
        trackingContext({ deliveryMode: 'vendor_delivery' })
      );
      const tracking = await service.getOrderTracking(customer, orderA, now);
      expect(tracking.rider).toBeNull();
      expect(repository.findAssignment).not.toHaveBeenCalled();
    });

    it('marks the rider stale when the last fix is old', async () => {
      repository.findAssignment.mockResolvedValue(assignment({ status: 'picked_up' }));
      repository.getRiderLocation.mockResolvedValue(location('2026-10-15T11:40:00.000Z'));
      const tracking = await service.getOrderTracking(customer, orderA, now);
      expect(tracking.rider?.stale).toBe(true);
      expect(tracking.etaAt).toBeNull();
    });

    it("404s someone else's order", async () => {
      repository.findOrderTrackingContext.mockResolvedValue(undefined);
      await expect(service.getOrderTracking(customer, orderA, now)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe('maps', () => {
    it('pins campus admins to their campus', async () => {
      await service.listRidersForAdmin(campusAdmin);
      expect(repository.listRiderPositions).toHaveBeenCalledWith({ campusId }, 300);

      await expect(
        service.listRidersForAdmin(campusAdmin, '11111111-1111-4111-8111-111111111199')
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('shows a fleet manager only their fleet', async () => {
      await service.listRidersForFleet(customer, 'fleet-1');
      expect(fleet.requireManagedFleet).toHaveBeenCalledWith(customer, 'fleet-1');
      expect(repository.listRiderPositions).toHaveBeenCalledWith(
        { campusId, fleetPartnerId: 'fleet-1' },
        300
      );
    });

    it('sets and clears pins inside the admin campus only', async () => {
      const point = await service.setPointCoordinates(
        campusAdmin,
        'location',
        '77777777-7777-4777-8777-77777777777a',
        { latitude: 7.629, longitude: 5.22 }
      );
      expect(point.latitude).toBe(7.629);

      repository.findPointCampus.mockResolvedValue('11111111-1111-4111-8111-111111111199');
      await expect(
        service.setPointCoordinates(campusAdmin, 'vendor', 'vendor-x', null)
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
