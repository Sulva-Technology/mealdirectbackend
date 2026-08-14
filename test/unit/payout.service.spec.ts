import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '../../src/config/env.service.js';
import type { PaystackClientContract } from '../../src/modules/payments/payments.types.js';
import { PayoutService } from '../../src/modules/settlements/payout.service.js';
import type {
  PayoutContext,
  PayoutGuardrails,
  PayoutRepositoryContract,
  PayoutTransferRecord
} from '../../src/modules/settlements/payout.types.js';

const initiatedBy = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settlementId = 'e1111111-1111-4111-8111-111111111111';

function makeEnv(payoutsEnabled: boolean): EnvService {
  return {
    get(key: string): unknown {
      return key === 'PAYOUTS_ENABLED' ? payoutsEnabled : undefined;
    }
  } as unknown as EnvService;
}

function makeContext(overrides: Partial<PayoutContext> = {}): PayoutContext {
  return { settlementId, payableKobo: 60000, recipientCode: 'RCP_existing', ...overrides };
}

const transferRecord: PayoutTransferRecord = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  settlementId,
  reference: `${settlementId}-a1`,
  amountKobo: 60000,
  providerTransferCode: 'TRF_1',
  status: 'pending',
  attempt: 1
};

const guardrails: PayoutGuardrails = { holdHours: 24, maxAttempts: 3 };

function makePaystack(): PaystackClientContract {
  return {
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    createRefund: vi.fn(),
    createTransferRecipient: vi.fn(),
    fetchTransferRecipient: vi.fn().mockResolvedValue({
      accountNumber: '0123456789',
      accountName: 'Jane Vendor',
      bankName: 'Kuda Bank',
      bankCode: '50211'
    }),
    initiateTransfer: vi
      .fn()
      .mockResolvedValue({ transferCode: 'TRF_1', status: 'pending', providerPayload: {} }),
    fetchTransfer: vi.fn(),
    createCustomer: vi.fn(),
    createDedicatedAccount: vi.fn()
  };
}

function makeRepository(context?: PayoutContext): PayoutRepositoryContract {
  return {
    findActiveTransfer: vi.fn().mockResolvedValue(undefined),
    findPayoutContext: vi.fn().mockResolvedValue(context),
    nextAttempt: vi.fn().mockResolvedValue(1),
    recordTransfer: vi.fn().mockResolvedValue(transferRecord),
    getPayoutGuardrails: vi.fn().mockResolvedValue(guardrails),
    selectPayableSettlements: vi.fn().mockResolvedValue([]),
    listPendingTransfers: vi.fn().mockResolvedValue([]),
    applyReconcile: vi.fn().mockResolvedValue(undefined),
    listTransfers: vi.fn(),
    findTransferById: vi.fn()
  };
}

describe('PayoutService', () => {
  let paystack: PaystackClientContract;

  beforeEach(() => {
    paystack = makePaystack();
  });

  it('refuses to pay when payouts are disabled', async () => {
    const service = new PayoutService(makeEnv(false), paystack, makeRepository(makeContext()));
    await expect(service.payToSettlement(settlementId, initiatedBy)).rejects.toThrow();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('initiates a transfer with a per-attempt reference', async () => {
    const repository = makeRepository(makeContext());
    repository.nextAttempt = vi.fn().mockResolvedValue(2);
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await service.payToSettlement(settlementId, initiatedBy);

    expect(paystack.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientCode: 'RCP_existing',
        amountKobo: 60000,
        reference: `${settlementId}-a2`
      })
    );
    expect(repository.recordTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, reference: `${settlementId}-a2`, initiatedBy })
    );
  });

  it('refuses to pay when the beneficiary has no recipient code', async () => {
    const repository = makeRepository(makeContext({ recipientCode: null }));
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await expect(service.payToSettlement(settlementId, initiatedBy)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('is idempotent when a pending/successful transfer already exists', async () => {
    const repository = makeRepository(makeContext());
    repository.findActiveTransfer = vi.fn().mockResolvedValue(transferRecord);
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.payToSettlement(settlementId, initiatedBy);

    expect(result).toEqual(transferRecord);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
    expect(repository.recordTransfer).not.toHaveBeenCalled();
  });

  it('runPayouts is a no-op when payouts are disabled', async () => {
    const repository = makeRepository(makeContext());
    const service = new PayoutService(makeEnv(false), paystack, repository);

    const result = await service.runPayouts();

    expect(result).toEqual({ selected: 0, initiated: 0, failed: 0 });
    expect(repository.selectPayableSettlements).not.toHaveBeenCalled();
  });

  it('runPayouts initiates one transfer per selected settlement and counts failures', async () => {
    const repository = makeRepository(makeContext());
    repository.selectPayableSettlements = vi.fn().mockResolvedValue([settlementId, 'other-id']);
    repository.findPayoutContext = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === 'other-id' ? makeContext({ recipientCode: null }) : makeContext())
      );
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.runPayouts();

    expect(result.selected).toBe(2);
    expect(result.initiated).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('reconcilePendingPayouts verifies each pending transfer and applies the status', async () => {
    const repository = makeRepository(makeContext());
    repository.listPendingTransfers = vi
      .fn()
      .mockResolvedValue([{ id: 't1', reference: `${settlementId}-a1` }]);
    paystack.fetchTransfer = vi
      .fn()
      .mockResolvedValue({ status: 'success', providerPayload: { ok: true } });
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.reconcilePendingPayouts();

    expect(paystack.fetchTransfer).toHaveBeenCalledWith(`${settlementId}-a1`);
    expect(repository.applyReconcile).toHaveBeenCalledWith(`${settlementId}-a1`, 'success', {
      ok: true
    });
    expect(result).toEqual({ scanned: 1, reconciled: 1 });
  });

  it('reconcilePendingPayouts skips transfers still pending at the provider', async () => {
    const repository = makeRepository(makeContext());
    repository.listPendingTransfers = vi
      .fn()
      .mockResolvedValue([{ id: 't1', reference: `${settlementId}-a1` }]);
    paystack.fetchTransfer = vi.fn().mockResolvedValue({ status: 'pending', providerPayload: {} });
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.reconcilePendingPayouts();

    expect(repository.applyReconcile).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
  });

  it('passes the configured maxAttempts into listTransfers', async () => {
    const repository = makeRepository(makeContext());
    repository.getPayoutGuardrails = vi.fn().mockResolvedValue({ holdHours: 24, maxAttempts: 5 });
    repository.listTransfers = vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 });
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await service.listTransfers({ status: 'failed', limit: 20 });

    expect(repository.listTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', limit: 20, maxAttempts: 5 })
    );
  });
});
