import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { AdminWalletsService } from '../../src/modules/wallets/admin-wallets.service.js';
import type { PlatformSettingsRepository } from '../../src/modules/wallets/platform-settings.repository.js';
import type {
  WalletRecord,
  WalletsRepositoryContract
} from '../../src/modules/wallets/wallets.types.js';

const admin: AuthenticatedActor = {
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'super_admin'
};

const wallet: WalletRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: '11111111-1111-4111-8111-111111111111',
  balanceKobo: 250_000,
  currency: 'NGN',
  status: 'active',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

function createRepository(): WalletsRepositoryContract {
  return {
    ensureWallet: vi.fn(),
    findWalletByUserId: vi.fn(),
    findWalletById: vi.fn().mockResolvedValue(wallet),
    findDedicatedAccount: vi.fn().mockResolvedValue(null),
    findDedicatedAccountError: vi.fn().mockResolvedValue(null),
    listLedgerEntries: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    listWallets: vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 }),
    adjustWallet: vi.fn().mockResolvedValue({ ...wallet, balanceKobo: 350_000 }),
    setWalletStatus: vi.fn().mockResolvedValue({ ...wallet, status: 'frozen' }),
    upsertDedicatedAccount: vi.fn(),
    listWalletIdsMissingDedicatedAccount: vi.fn()
  };
}

function createAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function createSettings(): PlatformSettingsRepository {
  return {
    findWalletLimits: vi
      .fn()
      .mockResolvedValue({ minTopupKobo: 50_000, maxBalanceKobo: 5_000_000 }),
    listSettings: vi.fn().mockResolvedValue([]),
    upsertSetting: vi.fn()
  } as unknown as PlatformSettingsRepository;
}

describe('AdminWalletsService', () => {
  let repository: WalletsRepositoryContract;
  let audit: AuditService;
  let settings: PlatformSettingsRepository;

  beforeEach(() => {
    repository = createRepository();
    audit = createAudit();
    settings = createSettings();
  });

  it('rejects a zero adjustment', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 0, reason: 'typo' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank reason', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 100_000, reason: '   ' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown wallet', async () => {
    repository.findWalletById = vi.fn().mockResolvedValue(undefined);
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.adjustWallet(admin, wallet.id, { amountKobo: 100_000, reason: 'goodwill' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adjusts and audits with before and after balances', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    const updated = await service.adjustWallet(admin, wallet.id, {
      amountKobo: 100_000,
      reason: 'goodwill credit'
    });

    expect(updated.balanceKobo).toBe(350_000);
    expect(repository.adjustWallet).toHaveBeenCalledWith(
      wallet.id,
      100_000,
      'goodwill credit',
      admin.userId
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.adjust',
        entityType: 'wallet',
        entityId: wallet.id,
        before: { balanceKobo: 250_000 },
        after: { balanceKobo: 350_000 }
      })
    );
  });

  it('freezes and audits', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    const updated = await service.setStatus(admin, wallet.id, 'frozen', 'chargeback risk');

    expect(updated.status).toBe('frozen');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.freeze', entityId: wallet.id })
    );
  });

  it('rejects an unknown settings key', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'drop_all_tables', 1)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects a negative settings value', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'wallet_min_topup_kobo', -1)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects a rider on-time share that exceeds the delivery base fee', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'share_rider_ontime_kobo', 999_999)).rejects.toThrow(
      /exceed|residual|invalid/i
    );
  });

  it('rejects a point-rider share that exceeds the point surcharge', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'share_point_rider_kobo', 999_999)).rejects.toThrow(
      /point|exceed|residual|invalid/i
    );
  });

  it('rejects a negative fee amount', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(service.updateSetting(admin, 'fee_delivery_base_kobo', -1)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects a non-positive vendor ready lead time', async () => {
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.updateSetting(admin, 'vendor_ready_lead_minutes', 0)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid fee share within the residual guard', async () => {
    settings.upsertSetting = vi.fn().mockResolvedValue({
      key: 'share_vendor_ontime_kobo',
      value: 5000,
      description: null,
      updatedBy: admin.userId,
      updatedAt: '2026-07-28T00:00:00.000Z'
    });
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.updateSetting(admin, 'share_vendor_ontime_kobo', 5000)
    ).resolves.toMatchObject({ value: 5000 });
  });

  it('still updates a non-fee key without the residual guard interfering', async () => {
    settings.upsertSetting = vi.fn().mockResolvedValue({
      key: 'wallet_min_topup_kobo',
      value: 60_000,
      description: null,
      updatedBy: admin.userId,
      updatedAt: '2026-07-28T00:00:00.000Z'
    });
    const service = new AdminWalletsService(repository, settings, audit);

    await expect(
      service.updateSetting(admin, 'wallet_min_topup_kobo', 60_000)
    ).resolves.toMatchObject({ value: 60_000 });
  });
});
