import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { normalizeCursorPagination } from '../../common/api/pagination.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaymentsService } from './payments.service.js';
import type { PaymentReconciliationResponse } from './payments.types.js';
import { ReconciliationRepository } from './reconciliation.repository.js';
import type {
  ReconciliationIssueDetail,
  ReconciliationIssueListFilter,
  ReconciliationIssueListResult,
  ReconciliationIssueRecord,
  ReconciliationIssueStatus,
  ReconciliationNoteRecord
} from './reconciliation.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(ReconciliationRepository) private readonly repository: ReconciliationRepository,
    @Inject(PaymentsService) private readonly payments: PaymentsService
  ) {}

  async scan(actor: AuthenticatedActor): Promise<{ detected: number }> {
    this.assertAdmin(actor);
    const detected = await this.repository.scan(900, 3600);
    return { detected };
  }

  async listIssues(
    actor: AuthenticatedActor,
    filter: ReconciliationIssueListFilter,
    pagination: { cursor?: string; limit?: number }
  ): Promise<ReconciliationIssueListResult> {
    const normalized = normalizeCursorPagination(pagination);
    return this.repository.listIssues(filter, normalized, this.adminCampusScope(actor));
  }

  async getIssue(actor: AuthenticatedActor, issueId: string): Promise<ReconciliationIssueDetail> {
    const issue = await this.requireIssue(actor, issueId);
    const notes = await this.repository.listNotes(issueId);
    return { ...issue, notes };
  }

  async addNote(
    actor: AuthenticatedActor,
    issueId: string,
    body: string
  ): Promise<ReconciliationNoteRecord> {
    await this.requireIssue(actor, issueId);
    return this.repository.addNote(issueId, actor.userId, body);
  }

  async reviewIssue(
    actor: AuthenticatedActor,
    issueId: string,
    input: { status: ReconciliationIssueStatus; resolutionNote?: string }
  ): Promise<ReconciliationIssueRecord> {
    await this.requireIssue(actor, issueId);
    const updated = await this.repository.reviewIssue(
      issueId,
      input.status,
      actor.userId,
      input.resolutionNote,
      this.adminCampusScope(actor)
    );
    if (updated === undefined) {
      throw notFound('Reconciliation issue was not found.');
    }
    return updated;
  }

  /**
   * Re-run Paystack verification for the issue's payment and mark it successful when it
   * matches. On success the issue is auto-resolved. Only safe when the issue points at a
   * local payment (verification validates reference, amount, and currency).
   */
  async verifyPayment(
    actor: AuthenticatedActor,
    issueId: string
  ): Promise<PaymentReconciliationResponse> {
    const issue = await this.requireIssue(actor, issueId);
    if (issue.paymentId === null) {
      throw badRequest('This issue has no local payment to verify against Paystack.');
    }

    const result = await this.payments.reconcilePaystackPayment(actor, issue.paymentId);
    await this.repository.reviewIssue(
      issueId,
      'resolved',
      actor.userId,
      'Auto-resolved by successful Paystack re-verification.',
      this.adminCampusScope(actor)
    );
    return result;
  }

  /**
   * Retry a failed webhook by re-verifying its payment. Only webhook_processing_failed
   * issues with a known local payment are retryable; provider_success_not_local has no
   * local payment to apply, so it must be resolved manually.
   */
  async retryWebhook(
    actor: AuthenticatedActor,
    issueId: string
  ): Promise<PaymentReconciliationResponse> {
    const issue = await this.requireIssue(actor, issueId);
    if (
      issue.issueType !== 'webhook_processing_failed' &&
      issue.issueType !== 'paid_order_pending'
    ) {
      throw badRequest('Only failed-webhook or paid-but-pending issues can be retried.');
    }
    if (issue.paymentId === null) {
      throw badRequest('This issue has no local payment to retry against Paystack.');
    }
    return this.verifyPayment(actor, issueId);
  }

  private async requireIssue(
    actor: AuthenticatedActor,
    issueId: string
  ): Promise<ReconciliationIssueRecord> {
    const issue = await this.repository.findIssueById(issueId, this.adminCampusScope(actor));
    if (issue === undefined) {
      throw notFound('Reconciliation issue was not found.');
    }
    return issue;
  }

  private assertAdmin(actor: AuthenticatedActor): void {
    if (actor.role !== 'super_admin' && actor.role !== 'campus_admin') {
      throw forbidden('Admin access is required.');
    }
  }

  private adminCampusScope(actor: AuthenticatedActor): string | undefined {
    if (actor.role === 'super_admin') return undefined;
    if (actor.role === 'campus_admin' && actor.campusId !== undefined) return actor.campusId;
    throw forbidden('Admin access is required.');
  }
}
