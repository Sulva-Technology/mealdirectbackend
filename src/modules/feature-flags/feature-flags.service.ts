import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { FeatureFlagsRepository } from './feature-flags.repository.js';
import type {
  FeatureFlag,
  FeatureFlagMode,
  FeatureFlagsRepositoryContract,
  FeatureSubject,
  FeatureTester,
  FeatureTesterSubjectType
} from './feature-flags.types.js';

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

/** The subject a signed-in actor is evaluated as: their user id plus their vendor, if any. */
export function subjectForActor(actor: AuthenticatedActor): FeatureSubject {
  return {
    userId: actor.userId,
    ...(actor.vendorId === undefined ? {} : { vendorId: actor.vendorId })
  };
}

/**
 * Feature flags with a tester cohort ("test mode"). off = nobody, test = only subjects in
 * feature_testers, on = everyone. Evaluation fails closed: a database error reads as off, so
 * a half-finished feature never leaks to real users because of an outage.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(
    @Inject(FeatureFlagsRepository) private readonly repository: FeatureFlagsRepositoryContract,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async isEnabled(key: string, subject: FeatureSubject): Promise<boolean> {
    try {
      const flag = await this.repository.findFlag(key);
      return await this.evaluate(flag?.mode ?? 'off', subject);
    } catch (error) {
      this.logger.error(
        `Feature flag "${key}" evaluation failed; treating as off: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
      return false;
    }
  }

  /** Every known flag resolved for one subject, for GET /me/feature-flags. */
  async enabledFlagsFor(subject: FeatureSubject): Promise<Record<string, boolean>> {
    const flags = await this.repository.listFlags();
    const needsTesterCheck = flags.some((flag) => flag.mode === 'test');
    const tester = needsTesterCheck ? await this.repository.isTester(subject) : false;

    const resolved: Record<string, boolean> = {};
    for (const flag of flags) {
      resolved[flag.key] = flag.mode === 'on' || (flag.mode === 'test' && tester);
    }
    return resolved;
  }

  listFlags(): Promise<FeatureFlag[]> {
    return this.repository.listFlags();
  }

  async setMode(
    actor: AuthenticatedActor,
    key: string,
    mode: FeatureFlagMode
  ): Promise<FeatureFlag> {
    const before = await this.repository.findFlag(key);
    if (before === undefined) {
      throw notFound(`Feature flag "${key}" was not found.`);
    }

    const updated = await this.repository.updateFlagMode(key, mode, actor.userId);
    if (updated === undefined) {
      throw notFound(`Feature flag "${key}" was not found.`);
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'feature_flag.update',
      entityType: 'feature_flag',
      before: { mode: before.mode },
      after: { mode: updated.mode },
      metadata: { key }
    });

    return updated;
  }

  listTesters(): Promise<FeatureTester[]> {
    return this.repository.listTesters();
  }

  async addTester(
    actor: AuthenticatedActor,
    subjectType: FeatureTesterSubjectType,
    subjectId: string,
    note: string | undefined
  ): Promise<FeatureTester> {
    if (!(await this.repository.subjectExists(subjectType, subjectId))) {
      throw badRequest(`No ${subjectType} exists with id ${subjectId}.`);
    }

    const tester = await this.repository.addTester(
      subjectType,
      subjectId,
      note ?? null,
      actor.userId
    );

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'feature_tester.add',
      entityType: 'feature_tester',
      entityId: tester.id,
      after: { subjectType, subjectId },
      metadata: {}
    });

    return tester;
  }

  async removeTester(actor: AuthenticatedActor, testerId: string): Promise<FeatureTester> {
    const removed = await this.repository.removeTester(testerId);
    if (removed === undefined) {
      throw notFound('Feature tester was not found.');
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'feature_tester.remove',
      entityType: 'feature_tester',
      entityId: removed.id,
      before: { subjectType: removed.subjectType, subjectId: removed.subjectId },
      metadata: {}
    });

    return removed;
  }

  private async evaluate(mode: FeatureFlagMode, subject: FeatureSubject): Promise<boolean> {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (subject.userId === undefined && subject.vendorId === undefined) return false;
    return this.repository.isTester(subject);
  }
}
