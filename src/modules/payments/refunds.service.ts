import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { normalizeCursorPagination } from '../../common/api/pagination.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaystackClient } from './paystack.client.js';
import type { PaystackClientContract, RefundStatus } from './payments.types.js';
import { RefundsRepository } from './refunds.repository.js';
import type {
  AdminRefundListFilter,
  AdminRefundListResult,
  AdminRefundRecord
} from './refunds.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

function mapRefundStatus(providerStatus: string): RefundStatus {
  if (providerStatus === 'processed' || providerStatus === 'success') return 'succeeded';
  if (providerStatus === 'failed') return 'failed';
  return 'processing';
}

@Injectable()
export class RefundsService {
  constructor(
    @Inject(RefundsRepository) private readonly repository: RefundsRepository,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async listRefunds(
    actor: AuthenticatedActor,
    filter: AdminRefundListFilter,
    pagination: { cursor?: string; limit?: number }
  ): Promise<AdminRefundListResult> {
    const normalized = normalizeCursorPagination(pagination);
    return this.repository.listRefunds(filter, normalized, this.adminCampusScope(actor));
  }

  async getRefund(actor: AuthenticatedActor, refundId: string): Promise<AdminRefundRecord> {
    return this.requireRefund(actor, refundId);
  }

  /**
   * Retry a failed refund by submitting a fresh Paystack refund against the original
   * transaction. Only refunds in a `failed` state are retryable; succeeded/processing
   * refunds are left untouched to avoid double-refunding.
   */
  async retryRefund(actor: AuthenticatedActor, refundId: string): Promise<AdminRefundRecord> {
    const refund = await this.requireRefund(actor, refundId);
    if (refund.status !== 'failed') {
      throw badRequest('Only failed refunds can be retried.');
    }

    const providerRefund = await this.paystack.createRefund({
      amountKobo: refund.amountKobo,
      transaction: refund.providerTransactionId ?? refund.providerReference ?? '',
      ...(refund.reasonText === null ? {} : { reasonText: refund.reasonText })
    });

    const status = mapRefundStatus(providerRefund.status);
    await this.repository.applyProviderRetry(
      refundId,
      providerRefund.id.toString(),
      providerRefund.providerPayload,
      status
    );

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'refund.retry',
      entityType: 'refund',
      entityId: refundId,
      ...(refund.campusId === null ? {} : { campusId: refund.campusId }),
      metadata: { status, providerRefundReference: providerRefund.id.toString() }
    });

    return this.requireRefund(actor, refundId);
  }

  /**
   * Record a manual resolution for a refund that cannot be settled automatically (e.g.
   * a bank transfer done out-of-band, or an unrecoverable failure). Terminal states only.
   */
  async resolveRefund(
    actor: AuthenticatedActor,
    refundId: string,
    input: { status: 'succeeded' | 'failed' | 'cancelled'; resolutionNote?: string; failureReason?: string }
  ): Promise<AdminRefundRecord> {
    const refund = await this.requireRefund(actor, refundId);
    if (refund.status === 'succeeded') {
      throw badRequest('This refund is already succeeded.');
    }

    const updated = await this.repository.markResolution(
      refundId,
      input.status,
      input.resolutionNote,
      input.failureReason,
      actor.userId,
      this.adminCampusScope(actor)
    );
    if (updated === undefined) {
      throw notFound('Refund was not found.');
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'refund.manual_resolution',
      entityType: 'refund',
      entityId: refundId,
      ...(refund.campusId === null ? {} : { campusId: refund.campusId }),
      before: { status: refund.status },
      after: { status: input.status },
      metadata: {
        ...(input.resolutionNote === undefined ? {} : { resolutionNote: input.resolutionNote }),
        ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason })
      }
    });

    return updated;
  }

  /**
   * Approve or reject a refund still in the `requested` state (customer/support request
   * flow). Approval does not itself move money — it authorizes a subsequent initiate.
   */
  async decideRefund(
    actor: AuthenticatedActor,
    refundId: string,
    decision: 'approve' | 'reject'
  ): Promise<AdminRefundRecord> {
    const refund = await this.requireRefund(actor, refundId);
    if (refund.status !== 'requested') {
      throw badRequest('Only requested refunds can be approved or rejected.');
    }

    const status: RefundStatus = decision === 'approve' ? 'approved' : 'cancelled';
    const updated = await this.repository.markResolution(
      refundId,
      status,
      undefined,
      undefined,
      actor.userId,
      this.adminCampusScope(actor)
    );
    if (updated === undefined) {
      throw notFound('Refund was not found.');
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: decision === 'approve' ? 'refund.approve' : 'refund.reject',
      entityType: 'refund',
      entityId: refundId,
      ...(refund.campusId === null ? {} : { campusId: refund.campusId }),
      before: { status: refund.status },
      after: { status }
    });

    return updated;
  }

  private async requireRefund(
    actor: AuthenticatedActor,
    refundId: string
  ): Promise<AdminRefundRecord> {
    const refund = await this.repository.findRefundById(refundId, this.adminCampusScope(actor));
    if (refund === undefined) {
      throw notFound('Refund was not found.');
    }
    return refund;
  }

  private adminCampusScope(actor: AuthenticatedActor): string | undefined {
    if (actor.role === 'super_admin') return undefined;
    if (actor.role === 'campus_admin' && actor.campusId !== undefined) return actor.campusId;
    throw forbidden('Admin access is required.');
  }
}
