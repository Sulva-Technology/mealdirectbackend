import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PaystackClientContract } from '../../src/modules/payments/payments.types.js';
import type { RefundsRepository } from '../../src/modules/payments/refunds.repository.js';
import { RefundsService } from '../../src/modules/payments/refunds.service.js';
import type { AdminRefundRecord } from '../../src/modules/payments/refunds.types.js';

const superAdmin: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'super_admin'
};

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const refund: AdminRefundRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  paymentId: '55555555-5555-4555-8555-555555555555',
  orderId: '66666666-6666-4666-8666-666666666666',
  orderNumber: 'MD-0001',
  campusId: '44444444-4444-4444-8444-444444444444',
  vendorId: '88888888-8888-4888-8888-888888888888',
  customerId: customer.userId,
  customerEmail: 'student@example.com',
  providerReference: 'MD-0001',
  providerTransactionId: '4099260516',
  providerRefundReference: null,
  amountKobo: 100000,
  reasonCode: 'customer_escalation',
  reasonText: 'Missing item',
  status: 'failed',
  failureReason: 'insufficient merchant balance',
  resolutionNote: null,
  requestedBy: superAdmin.userId,
  resolvedBy: null,
  requestedAt: '2026-07-03T09:00:00.000Z',
  processedAt: null,
  updatedAt: '2026-07-03T09:05:00.000Z'
};

function createRepository(): RefundsRepository {
  return {
    listRefunds: vi.fn().mockResolvedValue({ items: [refund], hasMore: false, limit: 20 }),
    findRefundById: vi.fn().mockResolvedValue(refund),
    applyProviderRetry: vi.fn().mockResolvedValue(undefined),
    markResolution: vi.fn().mockResolvedValue({ ...refund, status: 'succeeded' })
  } as unknown as RefundsRepository;
}

function createPaystack(): PaystackClientContract {
  return {
    createRefund: vi.fn().mockResolvedValue({
      amountKobo: refund.amountKobo,
      id: 3018284,
      providerPayload: { status: true },
      status: 'processed'
    }),
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    createTransferRecipient: vi.fn(),
    fetchTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn()
  };
}

function createAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('RefundsService', () => {
  let repository: RefundsRepository;
  let paystack: PaystackClientContract;
  let audit: AuditService;
  let service: RefundsService;

  beforeEach(() => {
    repository = createRepository();
    paystack = createPaystack();
    audit = createAudit();
    service = new RefundsService(repository, paystack, audit);
  });

  it('forbids non-admins', async () => {
    await expect(service.listRefunds(customer, {}, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('retries a failed refund against Paystack and audits it', async () => {
    await service.retryRefund(superAdmin, refund.id);
    expect(paystack.createRefund).toHaveBeenCalledWith({
      amountKobo: refund.amountKobo,
      transaction: refund.providerTransactionId,
      reasonText: refund.reasonText
    });
    expect(repository.applyProviderRetry).toHaveBeenCalledWith(
      refund.id,
      '3018284',
      { status: true },
      'succeeded'
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund.retry', entityType: 'refund' })
    );
  });

  it('refuses to retry a non-failed refund', async () => {
    vi.mocked(repository.findRefundById).mockResolvedValue({ ...refund, status: 'succeeded' });
    await expect(service.retryRefund(superAdmin, refund.id)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.createRefund).not.toHaveBeenCalled();
  });

  it('records a manual resolution and audits it', async () => {
    await service.resolveRefund(superAdmin, refund.id, {
      status: 'succeeded',
      resolutionNote: 'paid by bank transfer'
    });
    expect(repository.markResolution).toHaveBeenCalledWith(
      refund.id,
      'succeeded',
      'paid by bank transfer',
      undefined,
      superAdmin.userId,
      undefined
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund.manual_resolution' })
    );
  });

  it('404s an unknown refund', async () => {
    vi.mocked(repository.findRefundById).mockResolvedValue(undefined);
    await expect(service.getRefund(superAdmin, refund.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only approves/rejects requested refunds', async () => {
    await expect(service.decideRefund(superAdmin, refund.id, 'approve')).rejects.toBeInstanceOf(
      BadRequestException
    );

    vi.mocked(repository.findRefundById).mockResolvedValue({ ...refund, status: 'requested' });
    vi.mocked(repository.markResolution).mockResolvedValue({ ...refund, status: 'approved' });
    await service.decideRefund(superAdmin, refund.id, 'approve');
    expect(repository.markResolution).toHaveBeenCalledWith(
      refund.id,
      'approved',
      undefined,
      undefined,
      superAdmin.userId,
      undefined
    );
  });
});
