// Distance, stop ordering, and ETA estimates for campus deliveries. Pure functions: no I/O.
//
// ETAs are straight-line (great-circle) distance stretched by a detour factor, at an
// average campus riding speed, plus a fixed hand-off time per stop. That is honest for short
// campus trips without paying for a routing API, and the shape of RoutePlan lets a real
// routing provider replace estimateLegSeconds later without touching callers.

export type LatLng = { latitude: number; longitude: number };

const earthRadiusMeters = 6_371_008.8;

/** Campus paths are rarely straight: stretch crow-flies distance to approximate road distance. */
export const detourFactor = 1.35;

/** Time spent at each stop handing over food or collecting it. */
export const stopDwellSeconds = 120;

export const defaultAverageSpeedKmh = 15;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres (haversine). */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Estimated travelled distance between two points, in whole metres. */
export function estimateLegMeters(from: LatLng, to: LatLng): number {
  return Math.round(haversineMeters(from, to) * detourFactor);
}

export function estimateLegSeconds(meters: number, averageSpeedKmh: number): number {
  return Math.round(meters / ((averageSpeedKmh * 1000) / 3600));
}

export type RouteStopInput = {
  key: string;
  point: LatLng | null;
};

/**
 * Order drop-offs by repeatedly visiting the nearest remaining stop. Good enough for the
 * handful of drop points in one batch; stops without a map pin keep their input order and
 * go last, since nothing can be said about where they are.
 */
export function orderByNearestNeighbour<T extends RouteStopInput>(
  start: LatLng | null,
  stops: readonly T[]
): T[] {
  const located = stops.filter((stop) => stop.point !== null);
  const unlocated = stops.filter((stop) => stop.point === null);
  if (start === null) {
    return [...located, ...unlocated];
  }

  const ordered: T[] = [];
  const remaining = [...located];
  let cursor = start;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      if (stop.point === null) return;
      const distance = haversineMeters(cursor, stop.point);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (next?.point == null) break;
    ordered.push(next);
    cursor = next.point;
  }
  return [...ordered, ...unlocated];
}

export type PlannedStop<T> = T & {
  sequence: number;
  /** Distance from the previous point; null when either end has no map pin. */
  legDistanceMeters: number | null;
  /** Arrival estimate; null when the rider's position or any earlier pin is unknown. */
  etaAt: string | null;
  etaMinutes: number | null;
};

export type RoutePlan<T> = {
  stops: PlannedStop<T>[];
  totalDistanceMeters: number | null;
  finalEtaAt: string | null;
};

/**
 * Walk the stops in order from the rider's position and estimate arrival at each. Once a
 * leg cannot be measured (no rider position, or a stop without a pin) every later ETA is
 * unknown too, rather than silently skipping the gap.
 */
export function planRoute<T extends RouteStopInput>(
  origin: LatLng | null,
  orderedStops: readonly T[],
  now: Date,
  averageSpeedKmh: number
): RoutePlan<T> {
  let cursor = origin;
  let elapsedSeconds = 0;
  let etaKnown = origin !== null;
  let totalDistance = 0;
  let distanceKnown = origin !== null;

  const stops = orderedStops.map((stop, index): PlannedStop<T> => {
    let legDistanceMeters: number | null = null;
    if (cursor !== null && stop.point !== null) {
      legDistanceMeters = estimateLegMeters(cursor, stop.point);
      totalDistance += legDistanceMeters;
    } else {
      distanceKnown = false;
    }

    let etaAt: string | null = null;
    let etaMinutes: number | null = null;
    if (etaKnown && legDistanceMeters !== null) {
      elapsedSeconds += estimateLegSeconds(legDistanceMeters, averageSpeedKmh);
      etaAt = new Date(now.getTime() + elapsedSeconds * 1000).toISOString();
      etaMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60));
      elapsedSeconds += stopDwellSeconds;
    } else {
      etaKnown = false;
    }

    cursor = stop.point ?? cursor;
    if (stop.point === null) {
      cursor = null;
    }

    return { ...stop, etaAt, etaMinutes, legDistanceMeters, sequence: index + 1 };
  });

  const last = stops.at(-1);
  return {
    finalEtaAt: last?.etaAt ?? null,
    stops,
    totalDistanceMeters: distanceKnown && stops.length > 0 ? totalDistance : null
  };
}
