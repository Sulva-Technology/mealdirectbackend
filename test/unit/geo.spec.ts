import { describe, expect, it } from 'vitest';

import {
  detourFactor,
  estimateLegMeters,
  estimateLegSeconds,
  haversineMeters,
  orderByNearestNeighbour,
  planRoute,
  stopDwellSeconds
} from '../../src/domain/geo.js';

const now = new Date('2026-10-15T12:00:00.000Z');

describe('geo', () => {
  it('measures great-circle distance', () => {
    // One degree of latitude is ~111.2 km anywhere on Earth.
    expect(
      haversineMeters({ latitude: 7, longitude: 5 }, { latitude: 8, longitude: 5 })
    ).toBeCloseTo(111_195, -2);
    expect(
      haversineMeters({ latitude: 7.62, longitude: 5.22 }, { latitude: 7.62, longitude: 5.22 })
    ).toBe(0);
  });

  it('stretches straight-line distance for campus paths and converts to time', () => {
    const from = { latitude: 7.62, longitude: 5.22 };
    const to = { latitude: 7.629, longitude: 5.22 };
    expect(estimateLegMeters(from, to)).toBe(Math.round(haversineMeters(from, to) * detourFactor));
    // 1500 m at 15 km/h is 6 minutes.
    expect(estimateLegSeconds(1500, 15)).toBe(360);
  });

  it('visits the nearest remaining stop next and leaves unpinned stops last', () => {
    const start = { latitude: 0, longitude: 0 };
    const stops = [
      { key: 'far', point: { latitude: 0, longitude: 0.03 } },
      { key: 'unpinned', point: null },
      { key: 'near', point: { latitude: 0, longitude: 0.01 } },
      { key: 'middle', point: { latitude: 0, longitude: 0.02 } }
    ];

    expect(orderByNearestNeighbour(start, stops).map((stop) => stop.key)).toEqual([
      'near',
      'middle',
      'far',
      'unpinned'
    ]);
    // Without a start point the input order is kept.
    expect(orderByNearestNeighbour(null, stops).map((stop) => stop.key)).toEqual([
      'far',
      'near',
      'middle',
      'unpinned'
    ]);
  });

  it('accumulates leg times plus a hand-off pause per stop', () => {
    const origin = { latitude: 0, longitude: 0 };
    const first = { key: 'a', point: { latitude: 0, longitude: 0.01 } };
    const second = { key: 'b', point: { latitude: 0, longitude: 0.02 } };

    const plan = planRoute(origin, [first, second], now, 15);
    const [a, b] = plan.stops;
    const leg = estimateLegMeters(origin, first.point);
    const legSeconds = estimateLegSeconds(leg, 15);

    expect(a).toMatchObject({ legDistanceMeters: leg, sequence: 1 });
    expect(a?.etaAt).toBe(new Date(now.getTime() + legSeconds * 1000).toISOString());
    expect(b?.etaAt).toBe(
      new Date(now.getTime() + (2 * legSeconds + stopDwellSeconds) * 1000).toISOString()
    );
    expect(plan.totalDistanceMeters).toBe(2 * leg);
    expect(plan.finalEtaAt).toBe(b?.etaAt);
  });

  it('has no ETAs without a rider position but still measures legs between stops', () => {
    const plan = planRoute(
      null,
      [
        { key: 'a', point: { latitude: 0, longitude: 0.01 } },
        { key: 'b', point: { latitude: 0, longitude: 0.02 } }
      ],
      now,
      15
    );

    expect(plan.stops.map((stop) => stop.etaAt)).toEqual([null, null]);
    expect(plan.stops[0]?.legDistanceMeters).toBeNull();
    expect(plan.stops[1]?.legDistanceMeters).toBeGreaterThan(0);
    expect(plan.totalDistanceMeters).toBeNull();
  });

  it('stops estimating after a stop without a pin', () => {
    const plan = planRoute(
      { latitude: 0, longitude: 0 },
      [
        { key: 'a', point: { latitude: 0, longitude: 0.01 } },
        { key: 'unpinned', point: null },
        { key: 'b', point: { latitude: 0, longitude: 0.02 } }
      ],
      now,
      15
    );

    expect(plan.stops.map((stop) => stop.etaAt !== null)).toEqual([true, false, false]);
    expect(plan.finalEtaAt).toBeNull();
  });
});
