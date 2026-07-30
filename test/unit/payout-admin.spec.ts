import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../../src/modules/admin/admin.service.js';
import type { AdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { PayoutService } from '../../src/modules/settlements/payout.service.js';
import type { PayoutRepositoryContract } from '../../src/modules/settlements/payout.types.js';

const actor: AuthenticatedActor = {
  role: 'super_admin',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

// AdminService constructor is (repository, env?, invitations?, auth?, audit?, chat?, supportNotes?).
function makeAdminService(
  repository: Partial<AdminRepository>,
  record = vi.fn().mockResolvedValue(undefined)
): { service: AdminService; record: ReturnType<typeof vi.fn> } {
  const audit = { record } as unknown as AuditService;
  const service = new AdminService(
    repository as AdminRepository,
    undefined,
    undefined,
    undefined,
    audit
  );
  return { service, record };
}

describe('AdminService.reviewPayoutAccount', () => {
  it('approves a vendor payout account and audits it', async () => {
    const reviewVendorPayoutAccount = vi
      .fn()
      .mockResolvedValue({ id: 'v1', adminReviewStatus: 'approved' });
    const { service, record } = makeAdminService({ reviewVendorPayoutAccount });

    const result = await service.reviewPayoutAccount(actor, 'vendor', 'vendor-1', {
      status: 'approved'
    });

    expect(reviewVendorPayoutAccount).toHaveBeenCalledWith('vendor-1', 'approved', undefined);
    expect(result).toEqual({ id: 'v1', adminReviewStatus: 'approved' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout_account.review',
        entityType: 'vendor_payout_account'
      })
    );
  });

  it('rejects a rider payout account with a failure reason', async () => {
    const reviewRiderPayoutAccount = vi
      .fn()
      .mockResolvedValue({ id: 'r1', adminReviewStatus: 'rejected' });
    const { service, record } = makeAdminService({ reviewRiderPayoutAccount });

    await service.reviewPayoutAccount(actor, 'rider', 'rider-1', {
      status: 'rejected',
      failureReason: 'name mismatch'
    });

    expect(reviewRiderPayoutAccount).toHaveBeenCalledWith('rider-1', 'rejected', 'name mismatch');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'rider_payout_account',
        metadata: expect.objectContaining({ failureReason: 'name mismatch' })
      })
    );
  });

  it('throws NotFound when no active account matches', async () => {
    const reviewVendorPayoutAccount = vi.fn().mockResolvedValue(undefined);
    const { service } = makeAdminService({ reviewVendorPayoutAccount });

    await expect(
      service.reviewPayoutAccount(actor, 'vendor', 'missing', { status: 'approved' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PayoutService admin listing', () => {
  function makeRepo(overrides: Partial<PayoutRepositoryContract>): PayoutRepositoryContract {
    return {
      findActiveTransfer: vi.fn(),
      findPayoutContext: vi.fn(),
      nextAttempt: vi.fn(),
      recordTransfer: vi.fn(),
      getPayoutGuardrails: vi.fn().mockResolvedValue({ holdHours: 24, maxAttempts: 5 }),
      selectPayableSettlements: vi.fn(),
      listPendingTransfers: vi.fn(),
      applyReconcile: vi.fn(),
      listTransfers: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
      findTransferById: vi.fn(),
      ...overrides
    };
  }

  it('passes the configured maxAttempts into listTransfers', async () => {
    const repository = makeRepo({});
    const env = { get: () => true } as never;
    const paystack = {} as never;
    const service = new PayoutService(env, paystack, repository);

    await service.listTransfers({ status: 'failed', limit: 20 });

    expect(repository.listTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', limit: 20, maxAttempts: 5 })
    );
  });

  it('getTransfer delegates to the repository', async () => {
    const findTransferById = vi.fn().mockResolvedValue(undefined);
    const repository = makeRepo({ findTransferById });
    const service = new PayoutService({ get: () => true } as never, {} as never, repository);

    await service.getTransfer('t1');

    expect(findTransferById).toHaveBeenCalledWith('t1');
  });
});
