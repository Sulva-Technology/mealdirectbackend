import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { EnvService } from '../../src/config/env.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PayoutService } from '../../src/modules/settlements/payout.service.js';
import { WithdrawalsService } from '../../src/modules/settlements/withdrawals.service.js';
import type { WithdrawalsRepositoryContract } from '../../src/modules/settlements/withdrawals.types.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vendorId = 'b1111111-1111-4111-8111-111111111111';
const riderId = 'c1111111-1111-4111-8111-111111111111';
const settlementId = 'e1111111-1111-4111-8111-111111111111';

const vendor: AuthenticatedActor = { userId, role: 'vendor', vendorId };
const rider: AuthenticatedActor = { userId, role: 'rider' };

function makeEnv(payoutsEnabled = true): EnvService {
  return {
    get(key: string): unknown {
      return key === 'PAYOUTS_ENABLED' ? payoutsEnabled : undefined;
    }
  } as unknown as EnvService;
}

function makeRepository(
  overrides: Partial<WithdrawalsRepositoryContract> = {}
): WithdrawalsRepositoryContract {
  return {
    hasVendorAccess: vi.fn().mockResolvedValue(true),
    findRiderIdForUser: vi.fn().mockResolvedValue(riderId),
    getBalance: vi.fn().mockResolvedValue({
      availableKobo: 250000,
      pendingKobo: 80000,
      processingKobo: 0,
      minimumKobo: 100000,
      holdMinutes: 120,
      payoutAccountReady: true,
      enabled: true
    }),
    requestWithdrawal: vi
      .fn()
      .mockResolvedValue({ outcome: 'created', settlementId, amountKobo: 250000 }),
    ...overrides
  };
}

function makePayouts(result: unknown = { reference: `${settlementId}-a1`, status: 'pending' }) {
  return { payWithdrawal: vi.fn().mockResolvedValue(result) } as unknown as PayoutService;
}

describe('WithdrawalsService', () => {
  it('reports a withdrawable balance', async () => {
    const service = new WithdrawalsService(makeEnv(), makeRepository(), makePayouts());

    const balance = await service.getBalance(vendor);

    expect(balance).toMatchObject({ availableKobo: 250000, canWithdraw: true });
  });

  it('cannot withdraw below the minimum or while payouts are off', async () => {
    const repository = makeRepository({
      getBalance: vi.fn().mockResolvedValue({
        availableKobo: 50000,
        pendingKobo: 0,
        processingKobo: 0,
        minimumKobo: 100000,
        holdMinutes: 120,
        payoutAccountReady: true,
        enabled: true
      })
    });
    expect(
      (await new WithdrawalsService(makeEnv(), repository, makePayouts()).getBalance(vendor))
        .canWithdraw
    ).toBe(false);
    expect(
      (
        await new WithdrawalsService(makeEnv(false), makeRepository(), makePayouts()).getBalance(
          vendor
        )
      ).canWithdraw
    ).toBe(false);
  });

  it('creates the vendor withdrawal and pays it immediately', async () => {
    const repository = makeRepository();
    const payouts = makePayouts();
    const service = new WithdrawalsService(makeEnv(), repository, payouts);

    const result = await service.requestWithdrawal(vendor);

    expect(repository.requestWithdrawal).toHaveBeenCalledWith({ vendorId }, userId);
    expect(payouts.payWithdrawal).toHaveBeenCalledWith(settlementId, userId);
    expect(result).toEqual({
      settlementId,
      amountKobo: 250000,
      status: 'pending',
      reference: `${settlementId}-a1`
    });
  });

  it('resolves the rider from the user and reports an unknown outcome as processing', async () => {
    const repository = makeRepository();
    const service = new WithdrawalsService(makeEnv(), repository, {
      payWithdrawal: vi.fn().mockResolvedValue(undefined)
    } as unknown as PayoutService);

    const result = await service.requestWithdrawal(rider);

    expect(repository.requestWithdrawal).toHaveBeenCalledWith({ riderId }, userId);
    expect(result.status).toBe('processing');
  });

  it('turns a transfer Paystack failed on the spot into a retryable error', async () => {
    const service = new WithdrawalsService(
      makeEnv(),
      makeRepository(),
      makePayouts({ reference: 'r', status: 'failed' })
    );

    await expect(service.requestWithdrawal(vendor)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('explains why a request was refused', async () => {
    const belowMinimum = makeRepository({
      requestWithdrawal: vi
        .fn()
        .mockResolvedValue({ outcome: 'below_minimum', amountKobo: 50000, minimumKobo: 100000 })
    });
    await expect(
      new WithdrawalsService(makeEnv(), belowMinimum, makePayouts()).requestWithdrawal(vendor)
    ).rejects.toThrow('The minimum withdrawal is ₦1,000; you have ₦500 available.');

    const nothing = makeRepository({
      requestWithdrawal: vi
        .fn()
        .mockResolvedValue({ outcome: 'below_minimum', amountKobo: 0, minimumKobo: 100000 })
    });
    await expect(
      new WithdrawalsService(makeEnv(), nothing, makePayouts()).requestWithdrawal(vendor)
    ).rejects.toThrow('You have nothing available to withdraw yet.');

    const noAccount = makeRepository({
      requestWithdrawal: vi
        .fn()
        .mockResolvedValue({ outcome: 'no_payout_account', amountKobo: 0, minimumKobo: 100000 })
    });
    await expect(
      new WithdrawalsService(makeEnv(), noAccount, makePayouts()).requestWithdrawal(vendor)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never creates a withdrawal while payouts are off', async () => {
    const repository = makeRepository();
    const service = new WithdrawalsService(makeEnv(false), repository, makePayouts());

    await expect(service.requestWithdrawal(vendor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.requestWithdrawal).not.toHaveBeenCalled();
  });

  it('rejects vendors without access, unknown riders and other roles', async () => {
    const noAccess = makeRepository({ hasVendorAccess: vi.fn().mockResolvedValue(false) });
    await expect(
      new WithdrawalsService(makeEnv(), noAccess, makePayouts()).getBalance(vendor)
    ).rejects.toBeInstanceOf(ForbiddenException);

    const noRider = makeRepository({ findRiderIdForUser: vi.fn().mockResolvedValue(undefined) });
    await expect(
      new WithdrawalsService(makeEnv(), noRider, makePayouts()).getBalance(rider)
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      new WithdrawalsService(makeEnv(), makeRepository(), makePayouts()).getBalance({
        userId,
        role: 'customer'
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
