import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { WalletStatus } from '../../domain/wallet.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsRepository } from './wallets.repository.js';
import type {
  AdminWalletRecord,
  PlatformSettingRecord,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletRecord,
  WalletsRepositoryContract
} from './wallets.types.js';

// Only these keys may be written through the admin API. Slice B adds the fee-split keys here.
const editableSettingKeys = new Set(['wallet_min_topup_kobo', 'wallet_max_balance_kobo']);

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

@Injectable()
export class AdminWalletsService {
  constructor(
    @Inject(WalletsRepository) private readonly repository: WalletsRepositoryContract,
    @Inject(PlatformSettingsRepository) private readonly settings: PlatformSettingsRepository,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async listWallets(pagination: {
    cursor?: string;
    limit?: number;
  }): Promise<WalletPage<AdminWalletRecord>> {
    const limits = await this.settings.findWalletLimits();
    return this.repository.listWallets(
      normalizeCursorPagination(pagination),
      limits.maxBalanceKobo
    );
  }

  async listLedger(
    walletId: string,
    pagination: { cursor?: string; limit?: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    await this.requireWallet(walletId);
    return this.repository.listLedgerEntries(walletId, normalizeCursorPagination(pagination));
  }

  /**
   * The sensitive route: an administrator creating or destroying balance. It is the only way
   * to write a ledger entry with no provider reference, it requires a reason, it is audited,
   * and the resulting entry is visible in the ledger the customer can read.
   */
  async adjustWallet(
    actor: AuthenticatedActor,
    walletId: string,
    input: { amountKobo: number; reason: string }
  ): Promise<WalletRecord> {
    if (!Number.isInteger(input.amountKobo) || input.amountKobo === 0) {
      throw badRequest('Adjustment amount must be a non-zero whole number of kobo.');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw badRequest('A reason is required for a wallet adjustment.');
    }

    const before = await this.requireWallet(walletId);
    const after = await this.repository.adjustWallet(
      walletId,
      input.amountKobo,
      reason,
      actor.userId
    );

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'wallet.adjust',
      entityType: 'wallet',
      entityId: walletId,
      before: { balanceKobo: before.balanceKobo },
      after: { balanceKobo: after.balanceKobo },
      metadata: { amountKobo: input.amountKobo, reason, customerId: before.userId }
    });

    return after;
  }

  async setStatus(
    actor: AuthenticatedActor,
    walletId: string,
    status: WalletStatus,
    reason?: string
  ): Promise<WalletRecord> {
    const before = await this.requireWallet(walletId);
    const after = await this.repository.setWalletStatus(walletId, status);

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: status === 'frozen' ? 'wallet.freeze' : 'wallet.unfreeze',
      entityType: 'wallet',
      entityId: walletId,
      before: { status: before.status },
      after: { status: after.status },
      metadata: { customerId: before.userId, ...(reason === undefined ? {} : { reason }) }
    });

    return after;
  }

  listSettings(): Promise<PlatformSettingRecord[]> {
    return this.settings.listSettings();
  }

  async updateSetting(
    actor: AuthenticatedActor,
    key: string,
    value: number
  ): Promise<PlatformSettingRecord> {
    if (!editableSettingKeys.has(key)) {
      throw badRequest(
        `Setting "${key}" is not editable. Editable keys: ${[...editableSettingKeys].join(', ')}.`
      );
    }
    if (!Number.isInteger(value) || value < 0) {
      throw badRequest('Setting value must be a non-negative whole number of kobo.');
    }

    const before = await this.settings.listSettings();
    const updated = await this.settings.upsertSetting(key, value, actor.userId);

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'platform_setting.update',
      entityType: 'platform_setting',
      before: { value: before.find((setting) => setting.key === key)?.value ?? null },
      after: { value: updated.value },
      metadata: { key }
    });

    return updated;
  }

  private async requireWallet(walletId: string): Promise<WalletRecord> {
    const wallet = await this.repository.findWalletById(walletId);
    if (wallet === undefined) {
      throw notFound('Wallet was not found.');
    }
    return wallet;
  }
}
