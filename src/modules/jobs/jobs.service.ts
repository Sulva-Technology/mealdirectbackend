import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { OutboxListQueryDto, ProcessOutboxDto } from './dto/jobs.dto.js';
import { JobsRepository } from './jobs.repository.js';
import type { JobsRecord, OutboxProcessResult, SystemSummary } from './jobs.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

@Injectable()
export class JobsService {
  constructor(@Inject(JobsRepository) private readonly repository: JobsRepository) {}

  getSystemSummary(actor: AuthenticatedActor): Promise<SystemSummary> {
    this.assertAdmin(actor);
    return this.repository.getSystemSummary();
  }

  listOutboxEvents(actor: AuthenticatedActor, query: OutboxListQueryDto): Promise<JobsRecord[]> {
    this.assertAdmin(actor);
    return this.repository.listOutboxEvents(query);
  }

  claimAvailableOutboxEvents(
    actor: AuthenticatedActor,
    input: ProcessOutboxDto
  ): Promise<OutboxProcessResult> {
    this.assertAdmin(actor);
    return this.repository.claimAvailableOutboxEvents(
      input.limit ?? 10,
      input.workerId ?? `admin:${actor.userId}`
    );
  }

  private assertAdmin(actor: AuthenticatedActor): void {
    if (actor.role !== 'campus_admin' && actor.role !== 'super_admin') {
      throw forbidden('Admin role is required.');
    }
  }
}
