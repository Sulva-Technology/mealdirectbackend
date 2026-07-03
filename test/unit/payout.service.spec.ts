import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '../../src/config/env.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PaystackClientContract } from '../../src/modules/payments/payments.types.js';
import { PayoutService } from '../../src/modules/settlements/payout.service.js';
import type {
  PayoutContext,
  PayoutRepositoryContract,
  PayoutTransferRecord
} from '../../src/modules/settlements/payout.types.js';

const actor: AuthenticatedActor = {
  role: 'super_admin',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const settlementId = 'e1111111-1111-4111-8111-111111111111';

function makeEnv(payoutsEnabled: boolean): EnvService {
  return {
    get(key: string): unknown {
      return key === 'PAYOUTS_ENABLED' ? payoutsEnabled : undefined;
    }
  } as unknown as EnvService;
}

function makeContext(overrides: Partial<PayoutContext> = {}): PayoutContext {
  return {
    settlementId,
    payableKobo: 60000,
    recipientCode: 'RCP_existing',
    ...overrides
  };
}

const transferRecord: PayoutTransferRecord = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  settlementId,
  reference: settlementId,
  amountKobo: 60000,
  providerTransferCode: 'TRF_1',
  status: 'pending'
};

function makePaystack(): PaystackClientContract {
  return {
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    createRefund: vi.fn(),
    createTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn().mockResolvedValue({
      transferCode: 'TRF_1',
      status: 'pending',
      providerPayload: {}
    })
  };
}

function makeRepository(context?: PayoutContext): PayoutRepositoryContract {
  return {
    findTransferBySettlement: vi.fn().mockResolvedValue(undefined),
    findPayoutContext: vi.fn().mockResolvedValue(context),
    recordTransfer: vi.fn().mockResolvedValue(transferRecord)
  };
}

describe('PayoutService', () => {
  let paystack: PaystackClientContract;

  beforeEach(() => {
    paystack = makePaystack();
  });

  it('refuses to pay when payouts are disabled', async () => {
    const service = new PayoutService(makeEnv(false), paystack, makeRepository(makeContext()));

    await expect(service.payToSettlement(actor, settlementId)).rejects.toThrow();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('initiates and records a transfer against the provisioned recipient code', async () => {
    const repository = makeRepository(makeContext({ recipientCode: 'RCP_existing' }));
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.payToSettlement(actor, settlementId);

    expect(paystack.createTransferRecipient).not.toHaveBeenCalled();
    expect(paystack.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientCode: 'RCP_existing',
        amountKobo: 60000,
        reference: settlementId
      })
    );
    expect(repository.recordTransfer).toHaveBeenCalledTimes(1);
    expect(result).toEqual(transferRecord);
  });

  it('refuses to pay when the beneficiary has no provisioned recipient code', async () => {
    const repository = makeRepository(makeContext({ recipientCode: null }));
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await expect(service.payToSettlement(actor, settlementId)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.createTransferRecipient).not.toHaveBeenCalled();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
    expect(repository.recordTransfer).not.toHaveBeenCalled();
  });

  it('is idempotent per settlement when a transfer already exists', async () => {
    const repository = makeRepository(makeContext());
    repository.findTransferBySettlement = vi.fn().mockResolvedValue(transferRecord);
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.payToSettlement(actor, settlementId);

    expect(result).toEqual(transferRecord);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
    expect(repository.recordTransfer).not.toHaveBeenCalled();
  });
});
