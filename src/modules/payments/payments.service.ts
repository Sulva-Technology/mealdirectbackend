import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaystackClient } from './paystack.client.js';
import { PaymentsRepository } from './payments.repository.js';
import type {
  PaymentInitializationResponse,
  PaymentRecord,
  PaymentReconciliationResponse,
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
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract
  ) {}

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

    try {
      const verified = await this.paystack.verifyTransaction(payment.providerReference);

      if (verified.status !== 'success') return; // abandoned/failed/ongoing — leave pending
      if (verified.reference !== payment.providerReference) {
        this.logger.warn(`Paystack reference mismatch for order ${orderId}`);
        return;
      }
      if (verified.amountKobo !== payment.expectedAmountKobo) {
        this.logger.warn(
          `Paystack amount mismatch for order ${orderId}: got ${String(verified.amountKobo)}, expected ${String(payment.expectedAmountKobo)}`
        );
        return;
      }
      if (verified.currency !== payment.currency) {
        this.logger.warn(`Paystack currency mismatch for order ${orderId}`);
        return;
      }

      await this.repository.markPaymentSuccessfulFromProvider(
        payment.providerReference,
        verified.transactionId,
        verified.amountKobo,
        verified.providerPayload
      );
    } catch (error) {
      this.logger.warn(
        `Paystack verification fallback failed for order ${orderId}: ${describeError(error)}`
      );
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

  async listAdminPayments(actor: AuthenticatedActor): Promise<PaymentRecord[]> {
    return this.repository.listAdminPayments(this.adminCampusScope(actor));
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
