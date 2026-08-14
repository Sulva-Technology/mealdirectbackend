import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsRepository } from './wallets.repository.js';
import type {
  CustomerWalletView,
  DedicatedAccountRecord,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletsRepositoryContract
} from './wallets.types.js';

function customerOnly(actor: AuthenticatedActor): void {
  if (actor.role !== 'customer') {
    throw new ForbiddenException({
      code: ErrorCodes.FORBIDDEN,
      message: 'Only customers hold wallets.'
    });
  }
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

@Injectable()
export class WalletsService {
  constructor(
    @Inject(WalletsRepository) private readonly repository: WalletsRepositoryContract,
    @Inject(PlatformSettingsRepository) private readonly settings: PlatformSettingsRepository,
    @Inject(EnvService) private readonly env: EnvService
  ) {}

  /**
   * Reading the wallet provisions it. Signup also calls ensure_customer_wallet, but doing it
   * here too means a customer created before this slice — or one whose signup hook failed —
   * gets a working wallet on first view rather than a 404.
   */
  async getWallet(actor: AuthenticatedActor): Promise<CustomerWalletView> {
    customerOnly(actor);
    const walletId = await this.repository.ensureWallet(actor.userId);
    const [wallet, dedicatedAccount, limits] = await Promise.all([
      this.repository.findWalletById(walletId),
      this.repository.findDedicatedAccount(walletId),
      this.settings.findWalletLimits()
    ]);

    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} was provisioned but could not be read back.`);
    }

    return {
      balanceKobo: wallet.balanceKobo,
      currency: wallet.currency,
      status: wallet.status,
      minTopupKobo: limits.minTopupKobo,
      maxBalanceKobo: limits.maxBalanceKobo,
      dedicatedAccount
    };
  }

  async listLedger(
    actor: AuthenticatedActor,
    pagination: { cursor?: string; limit?: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    customerOnly(actor);
    const walletId = await this.repository.ensureWallet(actor.userId);
    return this.repository.listLedgerEntries(walletId, normalizeCursorPagination(pagination));
  }

  /**
   * Idempotent provision-or-retry for a wallet whose signup-time DVA attempt failed. When an
   * account already exists it is returned as-is; otherwise ensureWallet re-queues nothing (the
   * wallet exists) so we surface a clear "still provisioning" error and let the outbox retry.
   */
  async requestDedicatedAccount(actor: AuthenticatedActor): Promise<DedicatedAccountRecord> {
    customerOnly(actor);

    if (!this.env.get('WALLET_DVA_ENABLED')) {
      throw badRequest(
        'Dedicated account numbers are not available yet. Top up through the payment link instead.'
      );
    }

    const walletId = await this.repository.ensureWallet(actor.userId);
    const existing = await this.repository.findDedicatedAccount(walletId);
    if (existing !== null && existing.status === 'active') {
      return existing;
    }

    throw badRequest('Your dedicated account is still being created. Try again in a few minutes.');
  }
}
