import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PaymentsService } from '../../src/modules/payments/payments.service.js';
import { ReconciliationService } from '../../src/modules/payments/reconciliation.service.js';
import type { ReconciliationRepository } from '../../src/modules/payments/reconciliation.repository.js';
import type { ReconciliationIssueRecord } from '../../src/modules/payments/reconciliation.types.js';

const superAdmin: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'super_admin'
};

const campusAdmin: AuthenticatedActor = {
  userId: '33333333-3333-4333-8333-333333333333',
  role: 'campus_admin',
  campusId: '44444444-4444-4444-8444-444444444444'
};

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const issue: ReconciliationIssueRecord = {
  id: '99999999-9999-4999-8999-999999999999',
  issueType: 'webhook_processing_failed',
  status: 'open',
  severity: 'critical',
  paymentId: '55555555-5555-4555-8555-555555555555',
  orderId: '66666666-6666-4666-8666-666666666666',
  refundId: null,
  campusId: campusAdmin.campusId ?? null,
  providerReference: 'MD-0001',
  detail: { error: 'boom' },
  firstDetectedAt: '2026-07-03T08:00:00.000Z',
  lastDetectedAt: '2026-07-03T08:05:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  resolutionNote: null
};

function createRepository(): ReconciliationRepository {
  return {
    scan: vi.fn().mockResolvedValue(3),
    listIssues: vi
      .fn()
      .mockResolvedValue({ items: [issue], hasMore: false, limit: 20 }),
    findIssueById: vi.fn().mockResolvedValue(issue),
    listNotes: vi.fn().mockResolvedValue([]),
    addNote: vi.fn().mockResolvedValue({
      id: 'note-1',
      issueId: issue.id,
      authorId: superAdmin.userId,
      body: 'looking into it',
      createdAt: '2026-07-03T09:00:00.000Z'
    }),
    reviewIssue: vi.fn().mockResolvedValue({ ...issue, status: 'resolved' })
  } as unknown as ReconciliationRepository;
}

function createPayments(): PaymentsService {
  return {
    reconcilePaystackPayment: vi.fn().mockResolvedValue({
      orderId: issue.orderId,
      paymentId: issue.paymentId,
      providerReference: issue.providerReference,
      status: 'successful'
    })
  } as unknown as PaymentsService;
}

describe('ReconciliationService', () => {
  let repository: ReconciliationRepository;
  let payments: PaymentsService;
  let service: ReconciliationService;

  beforeEach(() => {
    repository = createRepository();
    payments = createPayments();
    service = new ReconciliationService(repository, payments);
  });

  it('rejects non-admin actors on scan and listing', async () => {
    await expect(service.scan(customer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listIssues(customer, {}, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scans and reports detected count for admins', async () => {
    await expect(service.scan(superAdmin)).resolves.toEqual({ detected: 3 });
    expect(repository.scan).toHaveBeenCalledWith(900, 3600);
  });

  it('returns issue detail with notes', async () => {
    await expect(service.getIssue(superAdmin, issue.id)).resolves.toEqual({ ...issue, notes: [] });
  });

  it('scopes campus admins to their campus when reading issues', async () => {
    await service.getIssue(campusAdmin, issue.id);
    expect(repository.findIssueById).toHaveBeenCalledWith(issue.id, campusAdmin.campusId);
  });

  it('404s when the issue is not visible', async () => {
    vi.mocked(repository.findIssueById).mockResolvedValue(undefined);
    await expect(service.getIssue(superAdmin, issue.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-verifies the payment and auto-resolves the issue', async () => {
    await expect(service.verifyPayment(superAdmin, issue.id)).resolves.toMatchObject({
      status: 'successful'
    });
    expect(payments.reconcilePaystackPayment).toHaveBeenCalledWith(superAdmin, issue.paymentId);
    expect(repository.reviewIssue).toHaveBeenCalledWith(
      issue.id,
      'resolved',
      superAdmin.userId,
      expect.any(String),
      undefined
    );
  });

  it('refuses to verify an issue with no local payment', async () => {
    vi.mocked(repository.findIssueById).mockResolvedValue({ ...issue, paymentId: null });
    await expect(service.verifyPayment(superAdmin, issue.id)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(payments.reconcilePaystackPayment).not.toHaveBeenCalled();
  });

  it('only retries retryable issue types', async () => {
    vi.mocked(repository.findIssueById).mockResolvedValue({
      ...issue,
      issueType: 'duplicate_success'
    });
    await expect(service.retryWebhook(superAdmin, issue.id)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('records an admin note against the issue', async () => {
    await service.addNote(superAdmin, issue.id, 'looking into it');
    expect(repository.addNote).toHaveBeenCalledWith(issue.id, superAdmin.userId, 'looking into it');
  });
});
