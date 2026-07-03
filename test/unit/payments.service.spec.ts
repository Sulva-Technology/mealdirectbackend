import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { PaymentsService } from '../../src/modules/payments/payments.service.js';
import type {
  PaystackClientContract,
  PaymentInitializationRecord,
  PaymentsRepositoryContract,
  PaymentRecord,
  RefundRecord
} from '../../src/modules/payments/payments.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'student@example.com',
  role: 'customer'
};

const superAdmin: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'super_admin'
};

const campusAdmin: AuthenticatedActor = {
  userId: '33333333-3333-4333-8333-333333333333',
  role: 'campus_admin',
  campusId: '44444444-4444-4444-8444-444444444444'
};

const payment: PaymentInitializationRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  orderId: '66666666-6666-4666-8666-666666666666',
  orderNumber: 'MD-0001',
  customerId: customer.userId,
  customerEmail: 'student@example.com',
  campusId: campusAdmin.campusId ?? '',
  orderStatus: 'pending_payment',
  orderTotalKobo: 515000,
  providerReference: 'MD-0001',
  paymentStatus: 'initialized',
  expectedAmountKobo: 515000,
  currency: 'NGN'
};

const paymentRecord: PaymentRecord = {
  ...payment,
  paidAmountKobo: null,
  providerTransactionId: null,
  providerPayload: {},
  initializedAt: '2026-06-15T08:00:00.000Z',
  paidAt: null,
  verifiedAt: null
};

const refund: RefundRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  paymentId: payment.id,
  orderId: payment.orderId,
  providerRefundReference: '3018284',
  amountKobo: 100000,
  reasonCode: 'customer_escalation',
  reasonText: 'Missing item',
  status: 'processing',
  requestedBy: superAdmin.userId,
  requestedAt: '2026-06-15T09:00:00.000Z',
  processedAt: null
};

function createRepository(): PaymentsRepositoryContract {
  return {
    findCustomerInitializationPayment: vi.fn().mockResolvedValue(payment),
    findStuckPaystackPayments: vi.fn().mockResolvedValue([payment]),
    markPaymentInitializationPayload: vi.fn().mockResolvedValue(paymentRecord),
    listAdminPaymentsPaged: vi
      .fn()
      .mockResolvedValue({ items: [paymentRecord], hasMore: false, limit: 20 }),
    findAdminPaymentById: vi.fn().mockResolvedValue(paymentRecord),
    getPaymentDetail: vi.fn().mockResolvedValue(undefined),
    getPaymentTimeline: vi.fn().mockResolvedValue([]),
    getPaymentWebhooks: vi.fn().mockResolvedValue([]),
    markPaymentSuccessfulFromProvider: vi.fn().mockResolvedValue(payment.orderId),
    getRefundedAmountKobo: vi.fn().mockResolvedValue(0),
    createRefundRequest: vi.fn().mockResolvedValue(refund),
    updateRefundProviderPayload: vi.fn().mockResolvedValue(refund)
  };
}

function createPaystack(): PaystackClientContract {
  return {
    createRefund: vi.fn().mockResolvedValue({
      amountKobo: 100000,
      id: 3018284,
      providerPayload: { status: true },
      status: 'pending'
    }),
    initializeTransaction: vi.fn().mockResolvedValue({
      accessCode: 'access_code',
      authorizationUrl: 'https://checkout.paystack.com/access_code',
      providerPayload: { status: true },
      reference: payment.providerReference
    }),
    verifyTransaction: vi.fn().mockResolvedValue({
      amountKobo: payment.expectedAmountKobo,
      currency: 'NGN',
      providerPayload: { status: true },
      reference: payment.providerReference,
      status: 'success',
      transactionId: '4099260516'
    }),
    createTransferRecipient: vi.fn().mockResolvedValue({
      providerPayload: { status: true },
      recipientCode: 'RCP_test'
    }),
    initiateTransfer: vi.fn().mockResolvedValue({
      providerPayload: { status: true },
      status: 'pending',
      transferCode: 'TRF_test'
    })
  };
}

describe('PaymentsService', () => {
  let repository: PaymentsRepositoryContract;
  let paystack: PaystackClientContract;
  let service: PaymentsService;

  beforeEach(() => {
    repository = createRepository();
    paystack = createPaystack();
    service = new PaymentsService(repository, paystack);
  });

  it('initializes Paystack using the stored payment amount and reference', async () => {
    await expect(service.initializePaystack(customer, payment.orderId)).resolves.toEqual({
      accessCode: 'access_code',
      authorizationUrl: 'https://checkout.paystack.com/access_code',
      paymentId: payment.id,
      reference: payment.providerReference
    });

    expect(paystack.initializeTransaction).toHaveBeenCalledWith({
      amountKobo: payment.expectedAmountKobo,
      currency: 'NGN',
      email: 'student@example.com',
      metadata: {
        orderId: payment.orderId,
        paymentId: payment.id
      },
      reference: payment.providerReference
    });
    expect(repository.markPaymentInitializationPayload).toHaveBeenCalledOnce();
  });

  it('rejects initialization if the stored payment amount differs from the order total', async () => {
    vi.mocked(repository.findCustomerInitializationPayment).mockResolvedValue({
      ...payment,
      expectedAmountKobo: payment.expectedAmountKobo - 1
    });

    await expect(service.initializePaystack(customer, payment.orderId)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('keeps customer initialization object-scoped to the owning customer', async () => {
    vi.mocked(repository.findCustomerInitializationPayment).mockResolvedValue(undefined);

    await expect(service.initializePaystack(customer, payment.orderId)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('scopes admin payment reads to campus admins', async () => {
    await expect(service.getAdminPayment(campusAdmin, payment.id)).resolves.toEqual(paymentRecord);

    vi.mocked(repository.findAdminPaymentById).mockResolvedValue(undefined);
    await expect(service.getAdminPayment(campusAdmin, payment.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('reconciles Paystack success only when provider amount matches local expected amount', async () => {
    await expect(service.reconcilePaystackPayment(superAdmin, payment.id)).resolves.toEqual({
      orderId: payment.orderId,
      paymentId: payment.id,
      providerReference: payment.providerReference,
      status: 'successful'
    });
    expect(repository.markPaymentSuccessfulFromProvider).toHaveBeenCalledWith(
      payment.providerReference,
      '4099260516',
      payment.expectedAmountKobo,
      { status: true }
    );

    vi.mocked(paystack.verifyTransaction).mockResolvedValue({
      amountKobo: payment.expectedAmountKobo - 1,
      currency: 'NGN',
      providerPayload: { status: true },
      reference: payment.providerReference,
      status: 'success',
      transactionId: '4099260516'
    });

    await expect(service.reconcilePaystackPayment(superAdmin, payment.id)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('marks a pending order paid when Paystack verify returns a matching success', async () => {
    await service.verifyPendingOrderPayment(customer.userId, payment.orderId);

    expect(paystack.verifyTransaction).toHaveBeenCalledWith(payment.providerReference);
    expect(repository.markPaymentSuccessfulFromProvider).toHaveBeenCalledWith(
      payment.providerReference,
      '4099260516',
      payment.expectedAmountKobo,
      { status: true }
    );
  });

  it('does not mark paid when no pending payment exists or Paystack is not successful', async () => {
    vi.mocked(repository.findCustomerInitializationPayment).mockResolvedValue(undefined);
    await service.verifyPendingOrderPayment(customer.userId, payment.orderId);
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    expect(repository.markPaymentSuccessfulFromProvider).not.toHaveBeenCalled();

    vi.mocked(repository.findCustomerInitializationPayment).mockResolvedValue(payment);
    vi.mocked(paystack.verifyTransaction).mockResolvedValue({
      amountKobo: payment.expectedAmountKobo,
      currency: 'NGN',
      providerPayload: { status: true },
      reference: payment.providerReference,
      status: 'abandoned',
      transactionId: '4099260516'
    });
    await service.verifyPendingOrderPayment(customer.userId, payment.orderId);
    expect(repository.markPaymentSuccessfulFromProvider).not.toHaveBeenCalled();
  });

  it('swallows Paystack errors and amount mismatches during fallback verify', async () => {
    vi.mocked(paystack.verifyTransaction).mockResolvedValue({
      amountKobo: payment.expectedAmountKobo - 1,
      currency: 'NGN',
      providerPayload: { status: true },
      reference: payment.providerReference,
      status: 'success',
      transactionId: '4099260516'
    });
    await expect(
      service.verifyPendingOrderPayment(customer.userId, payment.orderId)
    ).resolves.toBeUndefined();
    expect(repository.markPaymentSuccessfulFromProvider).not.toHaveBeenCalled();

    vi.mocked(paystack.verifyTransaction).mockRejectedValue(new Error('paystack down'));
    await expect(
      service.verifyPendingOrderPayment(customer.userId, payment.orderId)
    ).resolves.toBeUndefined();
    expect(repository.markPaymentSuccessfulFromProvider).not.toHaveBeenCalled();
  });

  it('reconciles stuck pending payments in a background sweep independent of customer polling', async () => {
    await expect(service.reconcilePendingPayments()).resolves.toEqual({
      scanned: 1,
      reconciled: 1
    });

    expect(repository.findStuckPaystackPayments).toHaveBeenCalledWith(120, 100);
    expect(paystack.verifyTransaction).toHaveBeenCalledWith(payment.providerReference);
    expect(repository.markPaymentSuccessfulFromProvider).toHaveBeenCalledWith(
      payment.providerReference,
      '4099260516',
      payment.expectedAmountKobo,
      { status: true }
    );
  });

  it('sweep leaves non-success and mismatched payments pending without throwing', async () => {
    vi.mocked(repository.findStuckPaystackPayments).mockResolvedValue([payment, payment]);
    vi.mocked(paystack.verifyTransaction)
      .mockResolvedValueOnce({
        amountKobo: payment.expectedAmountKobo,
        currency: 'NGN',
        providerPayload: { status: true },
        reference: payment.providerReference,
        status: 'abandoned',
        transactionId: '4099260516'
      })
      .mockRejectedValueOnce(new Error('paystack down'));

    await expect(service.reconcilePendingPayments()).resolves.toEqual({
      scanned: 2,
      reconciled: 0
    });
    expect(repository.markPaymentSuccessfulFromProvider).not.toHaveBeenCalled();
  });

  it('requires admin roles for reconciliation and refunds', async () => {
    await expect(service.reconcilePaystackPayment(customer, payment.id)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(
      service.initiateRefund(customer, payment.id, {
        amountKobo: 100000,
        reasonCode: 'customer_escalation',
        reasonText: 'Missing item'
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('initiates refunds without exceeding the paid amount minus prior refunds', async () => {
    vi.mocked(repository.findAdminPaymentById).mockResolvedValue({
      ...paymentRecord,
      paidAmountKobo: payment.expectedAmountKobo,
      paymentStatus: 'successful',
      providerTransactionId: '4099260516'
    });
    vi.mocked(repository.getRefundedAmountKobo).mockResolvedValue(200000);

    await expect(
      service.initiateRefund(superAdmin, payment.id, {
        amountKobo: 100000,
        reasonCode: 'customer_escalation',
        reasonText: 'Missing item'
      })
    ).resolves.toEqual(refund);

    await expect(
      service.initiateRefund(superAdmin, payment.id, {
        amountKobo: 400000,
        reasonCode: 'customer_escalation',
        reasonText: 'Too high'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
