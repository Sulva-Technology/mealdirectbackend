import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { SupportNotesService } from '../../common/support-notes/support-notes.service.js';
import type { SupportNoteRecord } from '../../common/support-notes/support-notes.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaystackClient } from './paystack.client.js';
import { PaymentsRepository } from './payments.repository.js';
import type {
  AdminPaymentDetail,
  AdminPaymentListFilter,
  AdminPaymentListResult,
  PaymentInitializationRecord,
  PaymentInitializationResponse,
  PaymentRecord,
  PaymentReconciliationResponse,
  PaymentTimelineEvent,
  PaymentWebhookRecord,
  PaymentsRepositoryContract,
  PaystackClientContract,
  RefundInput,
  RefundRecord,
  RefundStatus
} from './payments.types.js';

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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PaymentsRepository) private readonly repository: PaymentsRepositoryContract,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SupportNotesService) private readonly supportNotes: SupportNotesService
  ) {}

  /** Marks a payment as reviewed by an admin. Recorded as an audit entry plus an optional note. */
  async reviewPayment(
    actor: AuthenticatedActor,
    paymentId: string,
    note?: string
  ): Promise<AdminPaymentDetail> {
    const payment = await this.getAdminPayment(actor, paymentId);
    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'payment.reviewed',
      entityType: 'payment',
      entityId: paymentId,
      campusId: payment.campusId,
      ...(note === undefined ? {} : { metadata: { note } })
    });
    if (note !== undefined) {
      await this.supportNotes.add('payment', paymentId, actor.userId, note);
    }
    return this.getAdminPaymentDetail(actor, paymentId);
  }

  /** Appends an internal admin note to a payment. */
  async addAdminNote(
    actor: AuthenticatedActor,
    paymentId: string,
    note: string
  ): Promise<SupportNoteRecord> {
    await this.getAdminPayment(actor, paymentId);
    return this.supportNotes.add('payment', paymentId, actor.userId, note);
  }

  /**
   * Fallback for when no public webhook reaches us (local/test, or a missed webhook):
   * actively verify a still-pending order payment with Paystack and mark it paid on success.
   * Idempotent and best-effort — provider/mismatch failures are logged and swallowed so the
   * polled payment-status endpoint never breaks.
   */
  async verifyPendingOrderPayment(customerId: string, orderId: string): Promise<void> {
    let payment;
    try {
      payment = await this.repository.findCustomerInitializationPayment(customerId, orderId);
    } catch (error) {
      this.logger.warn(
        `Could not load pending payment for order ${orderId}: ${describeError(error)}`
      );
      return;
    }
    if (payment === undefined) return; // no initialized/pending paystack payment — nothing to verify

    await this.tryReconcilePayment(payment);
  }

  /**
   * Background sweep so payment resolution never depends on a webhook delivery or the customer
   * sitting on the payment-status poll screen. Verifies every still-pending Paystack payment
   * older than the stale window and marks paid those Paystack reports as a matching success.
   * Best-effort per payment — one failure never blocks the rest of the batch.
   */
  async reconcilePendingPayments(options?: {
    staleSeconds?: number;
    limit?: number;
  }): Promise<{ scanned: number; reconciled: number }> {
    const staleSeconds = options?.staleSeconds ?? 120;
    const limit = options?.limit ?? 100;

    let payments;
    try {
      payments = await this.repository.findStuckPaystackPayments(staleSeconds, limit);
    } catch (error) {
      this.logger.warn(`Could not load stuck payments for reconciliation: ${describeError(error)}`);
      return { scanned: 0, reconciled: 0 };
    }

    let reconciled = 0;
    for (const payment of payments) {
      if (await this.tryReconcilePayment(payment)) reconciled += 1;
    }

    this.logger.log(
      `Payment reconciliation sweep: scanned ${String(payments.length)}, reconciled ${String(reconciled)}`
    );
    return { scanned: payments.length, reconciled };
  }

  /**
   * Verify a single pending payment against Paystack and mark it paid on a matching success.
   * Returns true only when the payment was marked successful. Idempotent and best-effort:
   * provider/mismatch failures are logged and swallowed so callers never break.
   */
  private async tryReconcilePayment(payment: PaymentInitializationRecord): Promise<boolean> {
    const orderId = payment.orderId;
    try {
      const verified = await this.paystack.verifyTransaction(payment.providerReference);

      if (verified.status !== 'success') return false; // abandoned/failed/ongoing — leave pending
      if (verified.reference !== payment.providerReference) {
        this.logger.warn(`Paystack reference mismatch for order ${orderId}`);
        return false;
      }
      if (verified.amountKobo !== payment.expectedAmountKobo) {
        this.logger.warn(
          `Paystack amount mismatch for order ${orderId}: got ${String(verified.amountKobo)}, expected ${String(payment.expectedAmountKobo)}`
        );
        return false;
      }
      if (verified.currency !== payment.currency) {
        this.logger.warn(`Paystack currency mismatch for order ${orderId}`);
        return false;
      }

      await this.repository.markPaymentSuccessfulFromProvider(
        payment.providerReference,
        verified.transactionId,
        verified.amountKobo,
        verified.providerPayload
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Paystack verification fallback failed for order ${orderId}: ${describeError(error)}`
      );
      return false;
    }
  }

  async initializePaystack(
    actor: AuthenticatedActor,
    orderId: string
  ): Promise<PaymentInitializationResponse> {
    if (actor.role !== 'customer') {
      throw forbidden('Only customers can initialize order payments.');
    }

    const payment = await this.repository.findCustomerInitializationPayment(actor.userId, orderId);
    if (payment === undefined) {
      throw notFound('Order payment was not found.');
    }
    if (payment.orderStatus !== 'pending_payment') {
      throw badRequest('Only pending-payment orders can be initialized for payment.');
    }
    if (payment.expectedAmountKobo !== payment.orderTotalKobo) {
      throw badRequest('Stored payment amount does not match the order total.');
    }

    const email = payment.customerEmail ?? actor.email;
    if (email === undefined) {
      throw badRequest('Customer email is required to initialize Paystack payment.');
    }

    const initialized = await this.paystack.initializeTransaction({
      amountKobo: payment.expectedAmountKobo,
      currency: payment.currency,
      email,
      metadata: {
        orderId: payment.orderId,
        paymentId: payment.id
      },
      reference: payment.providerReference
    });

    await this.repository.markPaymentInitializationPayload(payment.id, initialized.providerPayload);

    return {
      accessCode: initialized.accessCode,
      authorizationUrl: initialized.authorizationUrl,
      paymentId: payment.id,
      reference: initialized.reference
    };
  }

  async listAdminPayments(
    actor: AuthenticatedActor,
    filter: AdminPaymentListFilter,
    pagination: { cursor?: string; limit?: number }
  ): Promise<AdminPaymentListResult> {
    const normalized = normalizeCursorPagination(pagination);
    return this.repository.listAdminPaymentsPaged(filter, normalized, this.adminCampusScope(actor));
  }

  async getAdminPayment(actor: AuthenticatedActor, paymentId: string): Promise<PaymentRecord> {
    const payment = await this.repository.findAdminPaymentById(
      paymentId,
      this.adminCampusScope(actor)
    );
    if (payment === undefined) {
      throw notFound('Payment was not found.');
    }
    return payment;
  }

  async getAdminPaymentDetail(
    actor: AuthenticatedActor,
    paymentId: string
  ): Promise<AdminPaymentDetail> {
    const detail = await this.repository.getPaymentDetail(paymentId, this.adminCampusScope(actor));
    if (detail === undefined) {
      throw notFound('Payment was not found.');
    }
    const notes = await this.supportNotes.list('payment', paymentId);
    return {
      ...detail,
      adminNotes: notes.map((n) => ({
        id: n.id,
        authorAdminId: n.authorId,
        note: n.body,
        createdAt: n.createdAt
      }))
    };
  }

  async getAdminPaymentTimeline(
    actor: AuthenticatedActor,
    paymentId: string
  ): Promise<PaymentTimelineEvent[]> {
    // Scope check first so campus admins cannot enumerate other campuses' timelines.
    await this.getAdminPayment(actor, paymentId);
    return this.repository.getPaymentTimeline(paymentId);
  }

  async getAdminPaymentWebhooks(
    actor: AuthenticatedActor,
    paymentId: string
  ): Promise<PaymentWebhookRecord[]> {
    const payment = await this.getAdminPayment(actor, paymentId);
    return this.repository.getPaymentWebhooks(payment.providerReference);
  }

  async reconcilePaystackPayment(
    actor: AuthenticatedActor,
    paymentId: string
  ): Promise<PaymentReconciliationResponse> {
    const payment = await this.getAdminPayment(actor, paymentId);
    const verified = await this.paystack.verifyTransaction(payment.providerReference);

    if (verified.status !== 'success') {
      throw badRequest('Paystack transaction is not successful.');
    }
    if (verified.reference !== payment.providerReference) {
      throw badRequest('Paystack transaction reference does not match this payment.');
    }
    if (verified.amountKobo !== payment.expectedAmountKobo) {
      throw badRequest('Paystack transaction amount does not match the expected amount.');
    }
    if (verified.currency !== payment.currency) {
      throw badRequest('Paystack transaction currency does not match this payment.');
    }

    const orderId = await this.repository.markPaymentSuccessfulFromProvider(
      payment.providerReference,
      verified.transactionId,
      verified.amountKobo,
      verified.providerPayload
    );

    return {
      orderId,
      paymentId: payment.id,
      providerReference: payment.providerReference,
      status: 'successful'
    };
  }

  /**
   * Manual force-paid override. Skips the Paystack verification gate that reconcilePaystackPayment
   * enforces — the operator has confirmed the capture out-of-band (e.g. seen it in the Paystack
   * dashboard) but the live reference cannot be re-verified from this environment. Reuses the same
   * RPC as the webhook/reconcile path so an expired order is recovered to paid with inventory and
   * batch booking intact. Reason is required and captured in both the audit log and the payment's
   * provider_payload. super_admin + campus_admin (campus-scoped via getAdminPayment).
   */
  async forcePaymentPaid(
    actor: AuthenticatedActor,
    paymentId: string,
    reason: string
  ): Promise<PaymentReconciliationResponse> {
    const payment = await this.getAdminPayment(actor, paymentId);
    if (payment.paymentStatus === 'successful') {
      throw badRequest('Payment is already successful.');
    }

    const orderId = await this.repository.forcePaymentPaidManual(
      payment.providerReference,
      payment.expectedAmountKobo,
      {
        manual_override: true,
        reason,
        actorUserId: actor.userId,
        forcedAt: new Date().toISOString()
      }
    );

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'payment.force_paid',
      entityType: 'payment',
      entityId: payment.id,
      campusId: payment.campusId,
      before: { paymentStatus: payment.paymentStatus, orderStatus: payment.orderStatus },
      after: { paymentStatus: 'successful', orderStatus: 'paid' },
      metadata: { reason, providerReference: payment.providerReference }
    });

    return {
      orderId,
      paymentId: payment.id,
      providerReference: payment.providerReference,
      status: 'successful'
    };
  }

  async initiateRefund(
    actor: AuthenticatedActor,
    paymentId: string,
    input: RefundInput
  ): Promise<RefundRecord> {
    const payment = await this.getAdminPayment(actor, paymentId);
    if (payment.paymentStatus !== 'successful') {
      throw badRequest('Only successful payments can be refunded.');
    }

    const paidAmountKobo = payment.paidAmountKobo ?? payment.expectedAmountKobo;
    const refundedAmountKobo = await this.repository.getRefundedAmountKobo(payment.id);
    const refundableAmountKobo = paidAmountKobo - refundedAmountKobo;
    if (input.amountKobo > refundableAmountKobo) {
      throw badRequest('Refund amount exceeds the remaining refundable balance.');
    }

    const refund = await this.repository.createRefundRequest(payment.id, input, actor.userId);
    const providerRefund = await this.paystack.createRefund({
      amountKobo: input.amountKobo,
      transaction: payment.providerTransactionId ?? payment.providerReference,
      ...(input.reasonText === undefined ? {} : { reasonText: input.reasonText })
    });

    return this.repository.updateRefundProviderPayload(
      refund.id,
      providerRefund.id.toString(),
      providerRefund.providerPayload,
      this.mapRefundStatus(providerRefund.status)
    );
  }

  private adminCampusScope(actor: AuthenticatedActor): string | undefined {
    if (actor.role === 'super_admin') return undefined;
    if (actor.role === 'campus_admin' && actor.campusId !== undefined) return actor.campusId;
    throw forbidden('Admin access is required.');
  }

  private mapRefundStatus(providerStatus: string): RefundStatus {
    if (providerStatus === 'processed' || providerStatus === 'success') return 'succeeded';
    if (providerStatus === 'failed') return 'failed';
    return 'processing';
  }
}
