import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { EscalationsRepository } from './escalations.repository.js';
import type {
  CreateEscalationInput,
  EscalationRecord,
  EscalationsRepositoryContract
} from './escalations.types.js';

const ineligibleEscalationStatuses = new Set(['cancelled', 'expired', 'pending_payment']);

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

@Injectable()
export class EscalationsService {
  constructor(
    @Inject(EscalationsRepository)
    private readonly repository: EscalationsRepositoryContract
  ) {}

  async listEscalations(actor: AuthenticatedActor, orderId: string): Promise<EscalationRecord[]> {
    this.assertCustomer(actor);
    const eligibility = await this.repository.findCustomerEscalationEligibility(
      actor.userId,
      orderId
    );
    if (eligibility === undefined) {
      throw notFound('Order was not found.');
    }
    return this.repository.listCustomerOrderEscalations(actor.userId, orderId);
  }

  async openEscalation(
    actor: AuthenticatedActor,
    orderId: string,
    input: CreateEscalationInput
  ): Promise<EscalationRecord> {
    this.assertCustomer(actor);
    const eligibility = await this.repository.findCustomerEscalationEligibility(
      actor.userId,
      orderId
    );
    if (eligibility === undefined) {
      throw notFound('Order was not found.');
    }
    if (ineligibleEscalationStatuses.has(eligibility.orderStatus)) {
      throw badRequest('Order is not eligible for escalation.');
    }

    const existing = await this.repository.findOpenCustomerEscalation(actor.userId, orderId);
    if (existing !== undefined) {
      return existing;
    }

    return this.repository.openCustomerEscalation(actor.userId, orderId, input);
  }

  private assertCustomer(actor: AuthenticatedActor): void {
    if (actor.role !== 'customer') {
      throw forbidden('Customer access is required.');
    }
  }
}
