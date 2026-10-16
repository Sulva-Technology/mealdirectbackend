import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvService } from '../../src/config/env.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { PlatformSettingsRepository } from '../../src/modules/wallets/platform-settings.repository.js';
import { WalletsService } from '../../src/modules/wallets/wallets.service.js';
import type {
  WalletRecord,
  WalletsRepositoryContract
} from '../../src/modules/wallets/wallets.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'student@example.com',
  role: 'customer'
};

const rider: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'rider'
};

const wallet: WalletRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: customer.userId,
  balanceKobo: 250_000,
  currency: 'NGN',
  status: 'active',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

function createRepository(): WalletsRepositoryContract {
  return {
    ensureWallet: vi.fn().mockResolvedValue(wallet.id),
    findWalletByUserId: vi.fn().mockResolvedValue(wallet),
    findWalletById: vi.fn().mockResolvedValue(wallet),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    findDedicatedAccountError: vi.fn().mockResolvedValue(null),
    listLedgerEntries: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    listWallets: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    adjustWallet: vi.fn().mockResolvedValue(wallet),
    setWalletStatus: vi.fn().mockResolvedValue(wallet),
    upsertDedicatedAccount: vi.fn(),
    listWalletIdsMissingDedicatedAccount: vi.fn().mockResolvedValue([])
  };
}

function createSettings(): PlatformSettingsRepository {
  return {
    findWalletLimits: vi.fn().mockResolvedValue({ minTopupKobo: 50_000, maxBalanceKobo: 5_000_000 })
  } as unknown as PlatformSettingsRepository;
}

function createEnv(dvaEnabled: boolean, passFees = false): EnvService {
  return {
    get: vi.fn((key: string) => {
      if (key === 'APP_URL_CUSTOMER') return 'https://user.mealdirectly.com';
      if (key === 'WALLET_TOPUP_PASS_FEES') return passFees;
      if (key === 'WALLET_DVA_DEPOSIT_FEE_BPS') return 100;
      if (key === 'WALLET_DVA_DEPOSIT_FEE_CAP_KOBO') return 30_000;
      return dvaEnabled;
    })
  } as unknown as EnvService;
}

const activeAccount = {
  accountNumber: '9900001111',
  accountName: 'MEALDIRECT / ADA LOVELACE',
  bankName: 'Wema Bank',
  bankSlug: 'wema-bank',
  status: 'active' as const
};

function createPaystack() {
  return {
    initializeTransaction: vi.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      reference: 'WTU-x',
      providerPayload: {}
    }),
    createCustomer: vi.fn().mockResolvedValue({ customerCode: 'CUS_abc', providerPayload: {} }),
    createDedicatedAccount: vi.fn().mockResolvedValue({ ...activeAccount, providerPayload: {} })
  };
}

function createDvaReads() {
  return {
    findWalletOwner: vi.fn().mockResolvedValue({
      walletId: wallet.id,
      userId: customer.userId,
      email: customer.email,
      displayName: 'Ada Lovelace',
      phoneNumber: '0803 123 4567'
    }),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    upsertDedicatedAccount: vi.fn().mockResolvedValue(undefined)
  };
}

describe('WalletsService', () => {
  let repository: WalletsRepositoryContract;
  let settings: PlatformSettingsRepository;
  let paystack: ReturnType<typeof createPaystack>;
  let dvaReads: ReturnType<typeof createDvaReads>;

  function createService(dvaEnabled: boolean, passFees = false): WalletsService {
    return new WalletsService(
      repository,
      settings,
      createEnv(dvaEnabled, passFees),
      paystack,
      dvaReads
    );
  }

  beforeEach(() => {
    repository = createRepository();
    settings = createSettings();
    paystack = createPaystack();
    dvaReads = createDvaReads();
  });

  it('provisions the wallet lazily and returns the balance with limits', async () => {
    const service = createService(false);

    const view = await service.getWallet(customer);

    expect(repository.ensureWallet).toHaveBeenCalledWith(customer.userId);
    expect(view).toEqual({
      balanceKobo: 250_000,
      currency: 'NGN',
      status: 'active',
      minTopupKobo: 50_000,
      maxBalanceKobo: 5_000_000,
      dedicatedAccountFeeBps: 100,
      dedicatedAccountFeeCapKobo: 30_000,
      dedicatedAccount: null,
      dedicatedAccountStatus: 'none',
      dedicatedAccountError: null
    });
  });

  it('refuses non-customer actors', async () => {
    const service = createService(false);

    await expect(service.getWallet(rider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects dedicated-account provisioning while the DVA flag is off', async () => {
    const service = createService(false);

    await expect(service.requestDedicatedAccount(customer)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('returns the existing account without re-queueing when one is already active', async () => {
    repository.findDedicatedAccount = vi.fn().mockResolvedValue({
      accountNumber: '9900001111',
      accountName: 'MEALDIRECT / ADA LOVELACE',
      bankName: 'Wema Bank',
      bankSlug: 'wema-bank',
      status: 'active'
    });
    const service = createService(true);

    const account = await service.requestDedicatedAccount(customer);

    expect(account.accountNumber).toBe('9900001111');
    // ensureWallet is idempotent and re-emits nothing for an existing wallet.
    expect(repository.ensureWallet).toHaveBeenCalledTimes(1);
  });

  it('caps the ledger page size', async () => {
    const service = createService(false);

    await service.listLedger(customer, { limit: 5000 });

    expect(repository.listLedgerEntries).toHaveBeenCalledWith(wallet.id, { limit: 100 });
  });

  it('provisions a dedicated account on demand for a wallet created while the flag was off', async () => {
    repository.findDedicatedAccount = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeAccount);
    const service = createService(true);

    const account = await service.requestDedicatedAccount(customer);

    expect(paystack.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: customer.email })
    );
    expect(paystack.createDedicatedAccount).toHaveBeenCalledWith({
      customerCode: 'CUS_abc',
      phone: '+2348031234567',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });
    expect(dvaReads.upsertDedicatedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: wallet.id, status: 'active' })
    );
    expect(account.accountNumber).toBe('9900001111');
  });

  it('retries provisioning when the previous attempt failed', async () => {
    repository.findDedicatedAccount = vi
      .fn()
      .mockResolvedValueOnce({ ...activeAccount, status: 'failed' })
      .mockResolvedValueOnce(activeAccount);
    const service = createService(true);

    await expect(service.requestDedicatedAccount(customer)).resolves.toMatchObject({
      status: 'active'
    });
    expect(paystack.createDedicatedAccount).toHaveBeenCalledTimes(1);
  });

  it('asks for a phone number when the wallet owner has none', async () => {
    dvaReads.findWalletOwner.mockResolvedValue({
      walletId: wallet.id,
      userId: customer.userId,
      email: customer.email,
      displayName: 'Ada Lovelace',
      phoneNumber: null
    });
    const service = createService(true);

    await expect(service.requestDedicatedAccount(customer)).rejects.toMatchObject({
      response: { message: 'Add a phone number to your profile to get a dedicated account number.' }
    });
    expect(paystack.createCustomer).not.toHaveBeenCalled();
  });

  it('asks for an email when the wallet owner has none', async () => {
    dvaReads.findWalletOwner.mockResolvedValue({
      walletId: wallet.id,
      userId: customer.userId,
      email: null,
      displayName: null
    });
    const service = createService(true);

    await expect(service.requestDedicatedAccount(customer)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.createCustomer).not.toHaveBeenCalled();
  });

  it('starts a checkout top-up even while dedicated accounts are off', async () => {
    const service = createService(false);

    const checkout = await service.initializeTopup(customer, 500_000);

    expect(checkout).toEqual({
      reference: 'WTU-x',
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      amountKobo: 500_000,
      feeKobo: 0,
      chargeKobo: 500_000
    });
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: customer.email,
        amountKobo: 500_000,
        currency: 'NGN',
        metadata: {
          purpose: 'wallet_topup',
          userId: customer.userId,
          walletId: wallet.id,
          creditKobo: '500000'
        },
        callbackUrl: 'https://user.mealdirectly.com/#/wallet'
      })
    );
    const [input] = paystack.initializeTransaction.mock.calls[0] as [{ reference: string }];
    expect(input.reference).toMatch(/^WTU-/);
  });

  it('rejects a top-up below the minimum', async () => {
    const service = createService(false);

    await expect(service.initializeTopup(customer, 10_000)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('rejects a top-up that would cross the balance limit', async () => {
    const service = createService(false);

    await expect(service.initializeTopup(customer, 4_900_000)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects top-ups from non-customers', async () => {
    const service = createService(false);

    await expect(service.initializeTopup(rider, 500_000)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('charges the Paystack fee on top and credits only the requested amount', async () => {
    const service = createService(false, true);

    const checkout = await service.initializeTopup(customer, 500_000);

    expect(checkout.feeKobo).toBeGreaterThan(0);
    expect(checkout.chargeKobo).toBe(500_000 + checkout.feeKobo);
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKobo: checkout.chargeKobo,
        metadata: expect.objectContaining({ creditKobo: '500000' }) as unknown
      })
    );
  });

  it('quotes the fee before checkout', () => {
    const quote = createService(false, true).quoteTopup(customer, 500_000);

    expect(quote.amountKobo).toBe(500_000);
    expect(quote.chargeKobo).toBe(500_000 + quote.feeKobo);
  });

  it('never shows a failed placeholder row as an account, and surfaces why it failed', async () => {
    repository.findDedicatedAccount = vi.fn().mockResolvedValue({
      accountNumber: `pending:${wallet.id}`,
      accountName: 'pending',
      bankName: 'pending',
      bankSlug: 'pending',
      status: 'failed'
    });
    repository.findDedicatedAccountError = vi
      .fn()
      .mockResolvedValue('Dedicated NUBAN is not available for this business');

    const view = await createService(true).getWallet(customer);

    expect(view.dedicatedAccount).toBeNull();
    expect(view.dedicatedAccountStatus).toBe('failed');
    expect(view.dedicatedAccountError).toBe('Dedicated NUBAN is not available for this business');
  });

  it('returns an active account as-is', async () => {
    repository.findDedicatedAccount = vi.fn().mockResolvedValue(activeAccount);

    const view = await createService(true).getWallet(customer);

    expect(view.dedicatedAccount).toEqual(activeAccount);
    expect(view.dedicatedAccountStatus).toBe('active');
    expect(view.dedicatedAccountError).toBeNull();
  });
});
