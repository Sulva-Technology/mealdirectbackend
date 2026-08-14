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
const editableSettingKeys = new Set([
  'wallet_min_topup_kobo',
  'wallet_max_balance_kobo',
  'fee_delivery_base_kobo',
  'fee_point_surcharge_kobo',
  'share_rider_ontime_kobo',
  'share_rider_late_kobo',
  'share_vendor_ontime_kobo',
  'share_point_rider_kobo',
  'vendor_ready_lead_minutes'
]);

// Fee-config keys, seeded in 20260728000100_fee_settings.sql. Amounts stay non-negative
// integers and the residual guard (below) keeps the platform's cut of the delivery fee
// from going negative.
const feeSettingKeys = new Set([
  'fee_delivery_base_kobo',
  'fee_point_surcharge_kobo',
  'share_rider_ontime_kobo',
  'share_rider_late_kobo',
  'share_vendor_ontime_kobo',
  'share_point_rider_kobo',
  'vendor_ready_lead_minutes'
]);

// Defaults mirror the seeds in 20260728000100_fee_settings.sql.
const defaultFeeDeliveryBaseKobo = 30_000;
const defaultShareRiderOntimeKobo = 10_000;
const defaultShareVendorOntimeKobo = 5_000;
const defaultFeePointSurchargeKobo = 10_000;
const defaultSharePointRiderKobo = 5_000;

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function invalidFeeSetting(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.INVALID_FEE_SETTING, message });
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
    if (!feeSettingKeys.has(key) && (!Number.isInteger(value) || value < 0)) {
      throw badRequest('Setting value must be a non-negative whole number of kobo.');
    }

    const before = await this.settings.listSettings();

    if (feeSettingKeys.has(key)) {
      this.assertFeeConfigValid(key, value, before);
    }

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

  /**
   * Fee-config keys must be non-negative whole kobo amounts (vendor_ready_lead_minutes must be
   * strictly positive). Two independent residual invariants keep the platform's share on any
   * delivery non-negative (resolve_order_delivery_shares makes the platform the residual and
   * raises 23000 — which, on the delivered transition, aborts the delivery — if it would go
   * negative):
   *   1) the two base shares the platform pays out (share_rider_ontime_kobo +
   *      share_vendor_ontime_kobo) may never exceed the base fee (fee_delivery_base_kobo);
   *   2) the point-delivery rider share (share_point_rider_kobo) may never exceed the point
   *      surcharge the customer is charged (fee_point_surcharge_kobo), since a point order's
   *      residual is (base leg) + (fee_point_surcharge_kobo - share_point_rider_kobo).
   */
  private assertFeeConfigValid(
    key: string,
    value: number,
    currentSettings: PlatformSettingRecord[]
  ): void {
    if (!Number.isInteger(value) || value < 0) {
      throw invalidFeeSetting(`Fee setting "${key}" must be a non-negative whole number.`);
    }
    if (key === 'vendor_ready_lead_minutes' && value <= 0) {
      throw invalidFeeSetting('vendor_ready_lead_minutes must be greater than zero.');
    }

    const residualKeys = new Set([
      'fee_delivery_base_kobo',
      'share_rider_ontime_kobo',
      'share_vendor_ontime_kobo',
      'fee_point_surcharge_kobo',
      'share_point_rider_kobo'
    ]);
    if (!residualKeys.has(key)) {
      return;
    }

    const currentValue = (settingKey: string, fallback: number): number => {
      const found = currentSettings.find((setting) => setting.key === settingKey);
      return typeof found?.value === 'number' ? found.value : fallback;
    };

    const resolved = (settingKey: string, fallback: number): number =>
      key === settingKey ? value : currentValue(settingKey, fallback);

    const base = resolved('fee_delivery_base_kobo', defaultFeeDeliveryBaseKobo);
    const riderOntime = resolved('share_rider_ontime_kobo', defaultShareRiderOntimeKobo);
    const vendorOntime = resolved('share_vendor_ontime_kobo', defaultShareVendorOntimeKobo);

    if (riderOntime + vendorOntime > base) {
      throw invalidFeeSetting(
        `share_rider_ontime_kobo (${String(riderOntime)}) + share_vendor_ontime_kobo (${String(vendorOntime)}) ` +
          `would exceed fee_delivery_base_kobo (${String(base)}), leaving the platform a negative residual.`
      );
    }

    const pointSurcharge = resolved('fee_point_surcharge_kobo', defaultFeePointSurchargeKobo);
    const pointRider = resolved('share_point_rider_kobo', defaultSharePointRiderKobo);

    if (pointRider > pointSurcharge) {
      throw invalidFeeSetting(
        `share_point_rider_kobo (${String(pointRider)}) would exceed fee_point_surcharge_kobo ` +
          `(${String(pointSurcharge)}), leaving the platform a negative residual on point deliveries.`
      );
    }
  }

  private async requireWallet(walletId: string): Promise<WalletRecord> {
    const wallet = await this.repository.findWalletById(walletId);
    if (wallet === undefined) {
      throw notFound('Wallet was not found.');
    }
    return wallet;
  }
}
