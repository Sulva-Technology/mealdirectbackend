import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { AnalyticsRepository } from './analytics.repository.js';
import type {
  AnalyticsRepositoryContract,
  FunnelQuery,
  FunnelStep,
  FunnelStepCounts,
  FunnelStepKey,
  RecordFunnelEventInput,
  SignupFunnel
} from './analytics.types.js';

const stepLabels: readonly [FunnelStepKey, string][] = [
  ['campus_link_opened', 'Opened campus link'],
  ['signup_started', 'Started signup'],
  ['signup_completed', 'Created account'],
  ['campus_selected', 'Picked campus'],
  ['location_selected', 'Picked delivery point'],
  ['onboarding_completed', 'Finished onboarding'],
  ['first_order', 'Placed first paid order']
];

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

export function toFunnelSteps(counts: FunnelStepCounts): FunnelStep[] {
  return stepLabels.map(([key, label]) => ({ key, label, count: counts[key] }));
}

/**
 * Signup funnel: the customer app reports the client-only steps, the backend derives
 * onboarding and first order from profiles/orders. Recording never throws — a lost
 * analytics event must not break signup.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(AnalyticsRepository) private readonly repository: AnalyticsRepositoryContract
  ) {}

  async recordEvent(input: RecordFunnelEventInput): Promise<void> {
    try {
      await this.repository.recordEvent(input);
    } catch (error) {
      this.logger.warn(
        `Funnel event "${input.event}" was not recorded: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  async getSignupFunnel(actor: AuthenticatedActor, query: FunnelQuery): Promise<SignupFunnel> {
    const campusId = this.campusScope(actor, query.campusId);
    const scoped: FunnelQuery = {
      ...(campusId === undefined ? {} : { campusId }),
      ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
      ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo })
    };

    const [counts, byCampus] = await Promise.all([
      this.repository.getStepCounts(scoped),
      this.repository.getCampusBreakdown(scoped)
    ]);

    return {
      campusId: campusId ?? null,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      steps: toFunnelSteps(counts),
      byCampus
    };
  }

  /** Same rule as AdminService: campus admins are pinned to their own campus. */
  private campusScope(actor: AuthenticatedActor, requestedCampusId?: string): string | undefined {
    if (actor.role === 'super_admin') {
      return requestedCampusId;
    }
    if (actor.role !== 'campus_admin' || actor.campusId === undefined) {
      throw forbidden('Admin campus scope is required.');
    }
    if (requestedCampusId !== undefined && requestedCampusId !== actor.campusId) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
    return actor.campusId;
  }
}
