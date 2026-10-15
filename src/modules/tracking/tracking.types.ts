import type { LatLng } from '../../domain/geo.js';

export type LocationFixInput = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  headingDegrees?: number;
  speedMps?: number;
  recordedAt?: string;
};

export type StoredRiderLocation = LatLng & {
  riderId: string;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  recordedAt: string;
  receivedAt: string;
};

/** Rider facts needed to decide whether it may share a location. */
export type TrackingRider = {
  id: string;
  campusId: string;
  displayName: string;
  status: string;
  active: boolean;
  available: boolean;
  openAssignmentCount: number;
};

export type RiderMapEntry = {
  riderId: string;
  displayName: string;
  phone: string;
  campusId: string;
  available: boolean;
  fleetPartnerId: string | null;
  fleetPartnerName: string | null;
  openAssignmentCount: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  recordedAt: string;
  /** True when the last fix is older than the freshness window; the rider may have lost signal. */
  stale: boolean;
};

export type TrackingAssignment = {
  id: string;
  batchId: string;
  riderId: string;
  status: string;
  vendorId: string;
  vendorName: string;
  vendorLatitude: number | null;
  vendorLongitude: number | null;
};

export type TrackingDropoffOrder = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  locationId: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
};

export type RouteStop = {
  sequence: number;
  type: 'pickup' | 'dropoff';
  vendorId: string | null;
  locationId: string | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  orderIds: string[];
  orderNumbers: string[];
  legDistanceMeters: number | null;
  etaAt: string | null;
  etaMinutes: number | null;
};

export type AssignmentRoute = {
  assignmentId: string;
  assignmentStatus: string;
  method: 'straight_line_estimate';
  averageSpeedKmh: number;
  computedAt: string;
  origin: (LatLng & { recordedAt: string }) | null;
  stops: RouteStop[];
  totalDistanceMeters: number | null;
  finalEtaAt: string | null;
};

export type OrderTrackingContext = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  deliveryMode: string;
  locationId: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  assignmentId: string | null;
  assignmentStatus: string | null;
  riderId: string | null;
  riderDisplayName: string | null;
};

export type OrderTrackingPhase =
  | 'awaiting_payment'
  | 'preparing'
  | 'awaiting_pickup'
  | 'on_the_way'
  | 'delivered'
  | 'closed';

export type OrderTracking = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  phase: OrderTrackingPhase;
  destination: {
    locationId: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  /** Shown only while the order is on its way, and only the rider's first name and position. */
  rider: {
    displayName: string;
    latitude: number | null;
    longitude: number | null;
    headingDegrees: number | null;
    lastSeenAt: string | null;
    stale: boolean;
  } | null;
  /** Stops the rider makes before this order, so the customer knows why the dot detours. */
  stopsBeforeYou: number | null;
  distanceMeters: number | null;
  etaAt: string | null;
  etaMinutes: number | null;
  method: 'straight_line_estimate';
  computedAt: string;
};

export type MapPoint = {
  id: string;
  kind: 'location' | 'vendor';
  name: string;
  zoneId: string | null;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type CoordinatesInput = { latitude: number; longitude: number } | null;
