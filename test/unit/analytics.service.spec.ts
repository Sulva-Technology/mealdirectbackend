import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { AnalyticsService, toFunnelSteps } from '../../src/modules/analytics/analytics.service.js';
import type {
  AnalyticsRepositoryContract,
  FunnelStepCounts
} from '../../src/modules/analytics/analytics.types.js';

const campusId = '11111111-1111-4111-8111-111111111111';
const otherCampusId = '22222222-2222-4222-8222-222222222222';
const superAdmin: AuthenticatedActor = { userId: 'a', role: 'super_admin' };
const campusAdmin: AuthenticatedActor = { userId: 'b', role: 'campus_admin', campusId };

const counts: FunnelStepCounts = {
  campus_link_opened: 100,
  signup_started: 80,
  signup_completed: 60,
  campus_selected: 55,
  location_selected: 50,
  onboarding_completed: 48,
  first_order: 20
};

function makeRepository(): {
  [K in keyof AnalyticsRepositoryContract]: ReturnType<typeof vi.fn>;
} {
  return {
    recordEvent: vi.fn().mockResolvedValue(undefined),
    getStepCounts: vi.fn().mockResolvedValue(counts),
    getCampusBreakdown: vi.fn().mockResolvedValue([])
  };
}

describe('AnalyticsService', () => {
  let repository: ReturnType<typeof makeRepository>;
  let service: AnalyticsService;

  beforeEach(() => {
    repository = makeRepository();
    service = new AnalyticsService(repository as unknown as AnalyticsRepositoryContract);
  });

  it('orders funnel steps from campus link to first order', () => {
    expect(toFunnelSteps(counts).map((step) => [step.key, step.count])).toEqual([
      ['campus_link_opened', 100],
      ['signup_started', 80],
      ['signup_completed', 60],
      ['campus_selected', 55],
      ['location_selected', 50],
      ['onboarding_completed', 48],
      ['first_order', 20]
    ]);
  });

  it('never fails the caller when an event cannot be stored', async () => {
    repository.recordEvent.mockRejectedValue(new Error('db down'));
    await expect(
      service.recordEvent({ event: 'signup_started', anonymousId: campusId })
    ).resolves.toBeUndefined();
  });

  it('lets a super admin query all campuses or one campus', async () => {
    const all = await service.getSignupFunnel(superAdmin, {});
    expect(all.campusId).toBeNull();
    expect(repository.getStepCounts).toHaveBeenLastCalledWith({});

    await service.getSignupFunnel(superAdmin, { campusId: otherCampusId, dateFrom: '2026-10-01' });
    expect(repository.getStepCounts).toHaveBeenLastCalledWith({
      campusId: otherCampusId,
      dateFrom: '2026-10-01'
    });
    expect(repository.getCampusBreakdown).toHaveBeenLastCalledWith({
      campusId: otherCampusId,
      dateFrom: '2026-10-01'
    });
  });

  it('pins a campus admin to their own campus', async () => {
    const funnel = await service.getSignupFunnel(campusAdmin, {});
    expect(funnel.campusId).toBe(campusId);
    expect(repository.getStepCounts).toHaveBeenLastCalledWith({ campusId });
  });

  it('refuses a campus admin asking for another campus', async () => {
    await expect(
      service.getSignupFunnel(campusAdmin, { campusId: otherCampusId })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getStepCounts).not.toHaveBeenCalled();
  });
});
