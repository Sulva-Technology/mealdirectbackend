import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import {
  defaultAverageSpeedKmh,
  orderByNearestNeighbour,
  planRoute,
  type LatLng
} from '../../domain/geo.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { FleetService } from '../fleet/fleet.service.js';
import { TrackingRepository } from './tracking.repository.js';
import type {
  AssignmentRoute,
  CoordinatesInput,
  LocationFixInput,
  MapPoint,
  OrderTracking,
  OrderTrackingContext,
  OrderTrackingPhase,
  RiderMapEntry,
  RouteStop,
  StoredRiderLocation,
  TrackingAssignment,
  TrackingDropoffOrder,
  TrackingRider
} from './tracking.types.js';

/** A fix older than this is shown as stale and is not used to compute ETAs. */
export const locationFreshSeconds = 5 * 60;
/** Phones can buffer fixes while offline; anything older than this is not worth storing. */
const maxFixAgeSeconds = 15 * 60;
/** Tolerate small device clock drift into the future. */
const maxFixFutureSeconds = 2 * 60;

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

function pointOf(latitude: number | null, longitude: number | null): LatLng | null {
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

export function isFresh(
  recordedAt: string,
  now: Date,
  freshSeconds = locationFreshSeconds
): boolean {
  return now.getTime() - new Date(recordedAt).getTime() <= freshSeconds * 1000;
}

/** Where the customer's order is in its journey, as one word the app can switch on. */
export function trackingPhase(
  orderStatus: string,
  assignmentStatus: string | null
): OrderTrackingPhase {
  switch (orderStatus) {
    case 'pending_payment':
      return 'awaiting_payment';
    case 'paid':
      return 'preparing';
    case 'ready':
      return assignmentStatus === 'picked_up' ? 'on_the_way' : 'awaiting_pickup';
    case 'out_for_delivery':
      return 'on_the_way';
    case 'delivered':
    case 'administratively_completed':
      return 'delivered';
    default:
      return 'closed';
  }
}

type StopDraft = Omit<RouteStop, 'sequence' | 'legDistanceMeters' | 'etaAt' | 'etaMinutes'> & {
  key: string;
  point: LatLng | null;
};

/** Group a batch's open orders into one drop-off stop per campus location. */
export function buildDropoffStops(orders: readonly TrackingDropoffOrder[]): StopDraft[] {
  const byLocation = new Map<string, StopDraft>();
  for (const order of orders) {
    const existing = byLocation.get(order.locationId);
    if (existing !== undefined) {
      existing.orderIds.push(order.orderId);
      existing.orderNumbers.push(order.orderNumber);
      continue;
    }
    byLocation.set(order.locationId, {
      key: `location:${order.locationId}`,
      latitude: order.latitude,
      locationId: order.locationId,
      longitude: order.longitude,
      name: order.locationName,
      orderIds: [order.orderId],
      orderNumbers: [order.orderNumber],
      point: pointOf(order.latitude, order.longitude),
      type: 'dropoff',
      vendorId: null
    });
  }
  return [...byLocation.values()];
}

@Injectable()
export class TrackingService {
  constructor(
    @Inject(TrackingRepository) private readonly repository: TrackingRepository,
    @Inject(FleetService) private readonly fleet: FleetService,
    @Optional() @Inject(EnvService) private readonly env?: EnvService
  ) {}

  // ---------------------------------------------------------------------------
  // Rider
  // ---------------------------------------------------------------------------

  /**
   * Store the rider's latest position. Only verified, active riders who are on shift or
   * mid-delivery may share; anyone else gets 409 so the app knows to stop sending.
   */
  async recordRiderLocation(
    actor: AuthenticatedActor,
    input: LocationFixInput,
    now = new Date()
  ): Promise<{ accepted: boolean; recordedAt: string }> {
    const rider = await this.requireRider(actor);
    if (rider.status !== 'verified' || !rider.active) {
      throw forbidden('Only verified, active riders can share their location.');
    }
    if (!rider.available && rider.openAssignmentCount === 0) {
      throw conflict('Go on shift to share your location.');
    }

    const recordedAt = input.recordedAt === undefined ? now : new Date(input.recordedAt);
    const ageSeconds = (now.getTime() - recordedAt.getTime()) / 1000;
    if (ageSeconds < -maxFixFutureSeconds) {
      throw badRequest('recordedAt is in the future. Check the device clock.');
    }
    // An old buffered fix is dropped quietly: it is not an error the rider can act on.
    if (ageSeconds > maxFixAgeSeconds) {
      return { accepted: false, recordedAt: recordedAt.toISOString() };
    }

    const accepted = await this.repository.upsertRiderLocation(rider.id, {
      ...input,
      recordedAt: recordedAt.toISOString()
    });
    return { accepted, recordedAt: recordedAt.toISOString() };
  }

  async stopSharingLocation(actor: AuthenticatedActor): Promise<{ stopped: true }> {
    const rider = await this.requireRider(actor);
    await this.repository.deleteRiderLocation(rider.id);
    return { stopped: true };
  }

  async getRiderAssignmentRoute(
    actor: AuthenticatedActor,
    assignmentId: string,
    now = new Date()
  ): Promise<AssignmentRoute> {
    const rider = await this.requireRider(actor);
    const assignment = await this.repository.findAssignment(assignmentId);
    if (assignment?.riderId !== rider.id) {
      throw notFound('Assignment was not found.');
    }
    return this.buildRoute(assignment, now);
  }

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  async getOrderTracking(
    actor: AuthenticatedActor,
    orderId: string,
    now = new Date()
  ): Promise<OrderTracking> {
    const context = await this.repository.findOrderTrackingContext(orderId, actor.userId);
    if (context === undefined) {
      throw notFound('Order was not found.');
    }

    const phase = trackingPhase(context.orderStatus, context.assignmentStatus);
    const base: OrderTracking = {
      computedAt: now.toISOString(),
      destination: {
        latitude: context.latitude,
        locationId: context.locationId,
        longitude: context.longitude,
        name: context.locationName
      },
      distanceMeters: null,
      etaAt: null,
      etaMinutes: null,
      method: 'straight_line_estimate',
      orderId: context.orderId,
      orderNumber: context.orderNumber,
      orderStatus: context.orderStatus,
      phase,
      rider: null,
      stopsBeforeYou: null
    };

    // Vendor-delivered orders and orders without a rider have nothing to track.
    if (
      context.deliveryMode !== 'meal_direct_rider' ||
      context.assignmentId === null ||
      (phase !== 'awaiting_pickup' && phase !== 'on_the_way')
    ) {
      return base;
    }

    const assignment = await this.repository.findAssignment(context.assignmentId);
    if (assignment === undefined) {
      return base;
    }
    const route = await this.buildRoute(assignment, now);
    const tracked = this.trackedStop(route, context);

    return {
      ...base,
      distanceMeters: tracked.distanceMeters,
      etaAt: tracked.stop?.etaAt ?? null,
      etaMinutes: tracked.stop?.etaMinutes ?? null,
      rider: phase === 'on_the_way' ? await this.riderForCustomer(context, now) : null,
      stopsBeforeYou: tracked.stopsBefore
    };
  }

  // ---------------------------------------------------------------------------
  // Admin and fleet maps
  // ---------------------------------------------------------------------------

  async listRidersForAdmin(actor: AuthenticatedActor, campusId?: string): Promise<RiderMapEntry[]> {
    return this.repository.listRiderPositions(
      this.adminCampusFilter(actor, campusId),
      locationFreshSeconds
    );
  }

  async listRidersForFleet(actor: AuthenticatedActor, partnerId: string): Promise<RiderMapEntry[]> {
    const partner = await this.fleet.requireManagedFleet(actor, partnerId);
    return this.repository.listRiderPositions(
      { campusId: partner.campusId, fleetPartnerId: partner.id },
      locationFreshSeconds
    );
  }

  async listMapPoints(actor: AuthenticatedActor, campusId: string): Promise<MapPoint[]> {
    this.assertAdminCampus(actor, campusId);
    return this.repository.listMapPoints(campusId);
  }

  async setPointCoordinates(
    actor: AuthenticatedActor,
    kind: MapPoint['kind'],
    id: string,
    coordinates: CoordinatesInput
  ): Promise<MapPoint> {
    const campusId = await this.repository.findPointCampus(kind, id);
    const label = kind === 'location' ? 'Location' : 'Vendor';
    if (campusId === undefined || !this.canAdminCampus(actor, campusId)) {
      throw notFound(`${label} was not found.`);
    }

    await this.repository.setPointCoordinates(kind, id, coordinates);
    const point = (await this.repository.listMapPoints(campusId)).find(
      (candidate) => candidate.kind === kind && candidate.id === id
    );
    if (point === undefined) {
      throw notFound(`${label} was not found.`);
    }
    return point;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private averageSpeedKmh(): number {
    return this.env?.get('RIDER_AVERAGE_SPEED_KMH') ?? defaultAverageSpeedKmh;
  }

  private async buildRoute(assignment: TrackingAssignment, now: Date): Promise<AssignmentRoute> {
    const averageSpeedKmh = this.averageSpeedKmh();
    const base = {
      assignmentId: assignment.id,
      assignmentStatus: assignment.status,
      averageSpeedKmh,
      computedAt: now.toISOString(),
      method: 'straight_line_estimate' as const
    };

    if (!['assigned', 'accepted', 'picked_up'].includes(assignment.status)) {
      return { ...base, finalEtaAt: null, origin: null, stops: [], totalDistanceMeters: null };
    }

    const [location, dropoffs] = await Promise.all([
      this.repository.getRiderLocation(assignment.riderId),
      this.repository.listOpenDropoffs(assignment.batchId)
    ]);
    const origin = location !== undefined && isFresh(location.recordedAt, now) ? location : null;

    const pickupPoint = pointOf(assignment.vendorLatitude, assignment.vendorLongitude);
    const needsPickup = assignment.status !== 'picked_up';
    const pickup: StopDraft[] = needsPickup
      ? [
          {
            key: `vendor:${assignment.vendorId}`,
            latitude: assignment.vendorLatitude,
            locationId: null,
            longitude: assignment.vendorLongitude,
            name: assignment.vendorName,
            orderIds: dropoffs.map((order) => order.orderId),
            orderNumbers: dropoffs.map((order) => order.orderNumber),
            point: pickupPoint,
            type: 'pickup',
            vendorId: assignment.vendorId
          }
        ]
      : [];

    const dropoffStart = needsPickup
      ? pickupPoint
      : pointOf(origin?.latitude ?? null, origin?.longitude ?? null);
    const orderedDropoffs = orderByNearestNeighbour(dropoffStart, buildDropoffStops(dropoffs));

    const plan = planRoute(
      origin === null ? null : { latitude: origin.latitude, longitude: origin.longitude },
      [...pickup, ...orderedDropoffs],
      now,
      averageSpeedKmh
    );

    return {
      ...base,
      finalEtaAt: plan.finalEtaAt,
      origin:
        origin === null
          ? null
          : {
              latitude: origin.latitude,
              longitude: origin.longitude,
              recordedAt: origin.recordedAt
            },
      stops: plan.stops.map(({ key: _key, point: _point, ...stop }) => stop),
      totalDistanceMeters: plan.totalDistanceMeters
    };
  }

  /** The drop-off stop carrying this order, the stops before it, and distance to it. */
  private trackedStop(
    route: AssignmentRoute,
    context: OrderTrackingContext
  ): { stop: RouteStop | undefined; stopsBefore: number | null; distanceMeters: number | null } {
    const index = route.stops.findIndex(
      (stop) => stop.type === 'dropoff' && stop.orderIds.includes(context.orderId)
    );
    if (index === -1) {
      return { distanceMeters: null, stop: undefined, stopsBefore: null };
    }

    let distance: number | null = 0;
    for (const stop of route.stops.slice(0, index + 1)) {
      distance =
        distance === null || stop.legDistanceMeters === null
          ? null
          : distance + stop.legDistanceMeters;
    }
    return { distanceMeters: distance, stop: route.stops[index], stopsBefore: index };
  }

  private async riderForCustomer(
    context: OrderTrackingContext,
    now: Date
  ): Promise<OrderTracking['rider']> {
    if (context.riderId === null) {
      return null;
    }
    const location: StoredRiderLocation | undefined = await this.repository.getRiderLocation(
      context.riderId
    );
    return {
      // First name only: customers see who is coming, not the rider's full identity.
      displayName: (context.riderDisplayName ?? 'Your rider').split(/\s+/)[0] ?? 'Your rider',
      headingDegrees: location?.headingDegrees ?? null,
      lastSeenAt: location?.recordedAt ?? null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      stale: location === undefined || !isFresh(location.recordedAt, now)
    };
  }

  private async requireRider(actor: AuthenticatedActor): Promise<TrackingRider> {
    const rider = await this.repository.findRiderForUser(actor.userId, actor.riderId);
    if (rider === undefined) {
      throw notFound('Rider profile was not found. Complete rider onboarding first.');
    }
    return rider;
  }

  private canAdminCampus(actor: AuthenticatedActor, campusId: string): boolean {
    if (actor.role === 'super_admin') return true;
    return actor.role === 'campus_admin' && actor.campusId === campusId;
  }

  private assertAdminCampus(actor: AuthenticatedActor, campusId: string): void {
    if (!this.canAdminCampus(actor, campusId)) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
  }

  private adminCampusFilter(actor: AuthenticatedActor, requested?: string): { campusId?: string } {
    if (actor.role === 'super_admin') {
      return requested === undefined ? {} : { campusId: requested };
    }
    if (actor.role !== 'campus_admin' || actor.campusId === undefined) {
      throw forbidden('Campus admin campus scope is required.');
    }
    if (requested !== undefined && requested !== actor.campusId) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
    return { campusId: actor.campusId };
  }
}
