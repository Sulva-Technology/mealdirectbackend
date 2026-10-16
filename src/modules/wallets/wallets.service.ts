import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { normalizeCursorPagination } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { WALLET_TOPUP_PURPOSE } from '../../domain/payments.js';
import { calculateTopupCharge } from '../../domain/wallet-topup-fee.js';
import {
  provisionDedicatedAccount,
  type DedicatedAccountProvisioner,
  type WalletReads
} from '../../worker/handlers/wallet-dva.handler.js';
import { WalletReadsRepository } from '../../worker/handlers/wallet-reads.repository.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaystackClient } from '../payments/paystack.client.js';
import type {
  PaystackInitializeInput,
  PaystackInitializeResult
} from '../payments/payments.types.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsRepository } from './wallets.repository.js';
import type {
  CustomerWalletView,
  DedicatedAccountRecord,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletsRepositoryContract,
  WalletTopupCheckout,
  WalletTopupQuote
} from './wallets.types.js';

export type WalletPaystack = DedicatedAccountProvisioner & {
  initializeTransaction: (input: PaystackInitializeInput) => Promise<PaystackInitializeResult>;
};

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
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(PaystackClient) private readonly paystack: WalletPaystack,
    @Inject(WalletReadsRepository) private readonly dvaReads: WalletReads
  ) {}

  /**
   * Reading the wallet provisions it. Signup also calls ensure_customer_wallet, but doing it
   * here too means a customer created before this slice — or one whose signup hook failed —
   * gets a working wallet on first view rather than a 404.
   */
  async getWallet(actor: AuthenticatedActor): Promise<CustomerWalletView> {
    customerOnly(actor);
    const walletId = await this.repository.ensureWallet(actor.userId);
    const [wallet, account, limits] = await Promise.all([
      this.repository.findWalletById(walletId),
      this.repository.findDedicatedAccount(walletId),
      this.settings.findWalletLimits()
    ]);
    // A failed or pending row holds placeholder bank details ("pending:<walletId>"); never
    // show it as an account the customer could transfer to.
    const dedicatedAccount = account !== null && account.status === 'active' ? account : null;
    const dedicatedAccountError =
      account?.status === 'failed'
        ? await this.repository.findDedicatedAccountError(walletId)
        : null;

    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} was provisioned but could not be read back.`);
    }

    return {
      balanceKobo: wallet.balanceKobo,
      currency: wallet.currency,
      status: wallet.status,
      minTopupKobo: limits.minTopupKobo,
      maxBalanceKobo: limits.maxBalanceKobo,
      dedicatedAccountFeeBps: this.env.get('WALLET_DVA_DEPOSIT_FEE_BPS'),
      dedicatedAccountFeeCapKobo: this.env.get('WALLET_DVA_DEPOSIT_FEE_CAP_KOBO'),
      dedicatedAccount,
      dedicatedAccountStatus: account?.status ?? 'none',
      dedicatedAccountError
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

  /** What the customer pays at checkout to receive amountKobo in the wallet. */
  quoteTopup(actor: AuthenticatedActor, amountKobo: number): WalletTopupQuote {
    customerOnly(actor);
    const { feeKobo, chargeKobo } = calculateTopupCharge(
      amountKobo,
      this.env.get('WALLET_TOPUP_PASS_FEES')
    );
    return { amountKobo, feeKobo, chargeKobo };
  }

  /**
   * Starts a Paystack checkout that funds the wallet. Works whether or not dedicated accounts
   * are enabled, so customers always have a way to top up. The charge.success webhook carries
   * the metadata back and credits the wallet by user id (credit_wallet_topup), idempotent on
   * the Paystack reference.
   */
  async initializeTopup(
    actor: AuthenticatedActor,
    amountKobo: number
  ): Promise<WalletTopupCheckout> {
    customerOnly(actor);

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      throw badRequest('Top-up amount must be a positive whole number of kobo.');
    }
    if (actor.email === undefined) {
      throw badRequest('Add an email address to your account before topping up.');
    }

    const walletId = await this.repository.ensureWallet(actor.userId);
    const [wallet, limits] = await Promise.all([
      this.repository.findWalletById(walletId),
      this.settings.findWalletLimits()
    ]);
    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} was provisioned but could not be read back.`);
    }

    if (amountKobo < limits.minTopupKobo) {
      throw badRequest(
        `The minimum top-up is ₦${(limits.minTopupKobo / 100).toLocaleString('en-NG')}.`
      );
    }
    if (wallet.balanceKobo + amountKobo > limits.maxBalanceKobo) {
      const headroomKobo = Math.max(0, limits.maxBalanceKobo - wallet.balanceKobo);
      throw badRequest(
        `That would take your wallet above the ₦${(limits.maxBalanceKobo / 100).toLocaleString('en-NG')} limit. ` +
          `You can add up to ₦${(headroomKobo / 100).toLocaleString('en-NG')}.`
      );
    }

    // The customer pays Paystack's fee on top; the webhook credits only amountKobo.
    const { feeKobo, chargeKobo } = calculateTopupCharge(
      amountKobo,
      this.env.get('WALLET_TOPUP_PASS_FEES')
    );
    const reference = `WTU-${randomUUID()}`;
    const checkout = await this.paystack.initializeTransaction({
      email: actor.email,
      amountKobo: chargeKobo,
      currency: wallet.currency,
      reference,
      metadata: {
        purpose: WALLET_TOPUP_PURPOSE,
        userId: actor.userId,
        walletId,
        creditKobo: String(amountKobo)
      },
      callbackUrl: `${this.env.get('APP_URL_CUSTOMER')}/#/wallet`
    });

    return {
      reference: checkout.reference,
      authorizationUrl: checkout.authorizationUrl,
      accessCode: checkout.accessCode,
      amountKobo,
      feeKobo,
      chargeKobo
    };
  }

  /**
   * Idempotent provision-or-retry for the customer dedicated account. Provisions synchronously
   * when no active account exists — covering wallets created while the flag was off (their
   * outbox event completed as a no-op) and ones whose earlier attempt failed.
   */
  async requestDedicatedAccount(actor: AuthenticatedActor): Promise<DedicatedAccountRecord> {
    customerOnly(actor);

    if (!this.env.get('WALLET_DVA_ENABLED')) {
      throw badRequest(
        'Dedicated account numbers are not available yet. Top up with card or bank transfer instead.'
      );
    }

    const walletId = await this.repository.ensureWallet(actor.userId);
    const existing = await this.repository.findDedicatedAccount(walletId);
    if (existing !== null && existing.status === 'active') {
      return existing;
    }

    const outcome = await provisionDedicatedAccount(walletId, this.dvaReads, this.paystack);
    if (outcome === 'missing_email') {
      throw badRequest('Add an email address to your account to get a dedicated account number.');
    }
    if (outcome === 'missing_phone') {
      throw badRequest('Add a phone number to your profile to get a dedicated account number.');
    }

    const account = await this.repository.findDedicatedAccount(walletId);
    if (account !== null && account.status === 'active') {
      return account;
    }

    throw badRequest('Your dedicated account is still being created. Try again in a few minutes.');
  }
}
