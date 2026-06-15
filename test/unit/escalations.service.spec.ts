import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { EscalationsService } from '../../src/modules/escalations/escalations.service.js';
import type {
  EscalationEligibility,
  EscalationRecord,
  EscalationsRepositoryContract
} from '../../src/modules/escalations/escalations.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const vendor: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'vendor',
  vendorId: '33333333-3333-4333-8333-333333333333'
};

const eligibility: EscalationEligibility = {
  orderId: '44444444-4444-4444-8444-444444444444',
  orderStatus: 'paid'
};

const escalation: EscalationRecord = {
  assignedAdminId: null,
  category: 'undelivered',
  createdAt: '2026-06-15T09:00:00.000Z',
  description: 'The order never arrived.',
  id: '55555555-5555-4555-8555-555555555555',
  openedAt: '2026-06-15T09:00:00.000Z',
  openedBy: customer.userId,
  orderId: eligibility.orderId,
  refundId: null,
  resolution: null,
  resolvedAt: null,
  status: 'open',
  updatedAt: '2026-06-15T09:00:00.000Z'
};

function createRepository(): EscalationsRepositoryContract {
  return {
    findCustomerEscalationEligibility: vi.fn().mockResolvedValue(eligibility),
    findOpenCustomerEscalation: vi.fn().mockResolvedValue(undefined),
    listCustomerOrderEscalations: vi.fn().mockResolvedValue([escalation]),
    openCustomerEscalation: vi.fn().mockResolvedValue(escalation)
  };
}

describe('EscalationsService', () => {
  let repository: EscalationsRepositoryContract;
  let service: EscalationsService;

  beforeEach(() => {
    repository = createRepository();
    service = new EscalationsService(repository);
  });

  it('opens an escalation for an eligible customer-owned order', async () => {
    await expect(
      service.openEscalation(customer, eligibility.orderId, {
        category: 'undelivered',
        description: 'The order never arrived.'
      })
    ).resolves.toEqual(escalation);

    expect(repository.openCustomerEscalation).toHaveBeenCalledWith(
      customer.userId,
      eligibility.orderId,
      {
        category: 'undelivered',
        description: 'The order never arrived.'
      }
    );
  });

  it('returns the existing open escalation instead of creating a duplicate', async () => {
    vi.mocked(repository.findOpenCustomerEscalation).mockResolvedValue(escalation);

    await expect(
      service.openEscalation(customer, eligibility.orderId, {
        category: 'quality',
        description: 'Different description.'
      })
    ).resolves.toEqual(escalation);

    expect(repository.openCustomerEscalation).not.toHaveBeenCalled();
  });

  it('rejects ineligible and non-owned orders', async () => {
    vi.mocked(repository.findCustomerEscalationEligibility).mockResolvedValueOnce({
      ...eligibility,
      orderStatus: 'pending_payment'
    });

    await expect(
      service.openEscalation(customer, eligibility.orderId, {
        category: 'undelivered',
        description: 'The order never arrived.'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    vi.mocked(repository.findCustomerEscalationEligibility).mockResolvedValueOnce(undefined);
    await expect(service.listEscalations(customer, eligibility.orderId)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('requires a customer actor', async () => {
    await expect(service.listEscalations(vendor, eligibility.orderId)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
