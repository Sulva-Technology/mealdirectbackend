import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { PaystackClient } from '../payments/paystack.client.js';
import type { PaystackClientContract } from '../payments/payments.types.js';
import { PayoutRepository } from './payout.repository.js';
import type {
  PayoutDestination,
  PayoutRepositoryContract,
  PayoutTransferListItem,
  PayoutTransferPage,
  PayoutTransferRecord,
  RecordTransferInput
} from './payout.types.js';

// Paystack transfer status → our terminal reconcile status. Anything else (pending, otp,
// ongoing) is left untouched for a later sweep.
function terminalTransferStatus(status: string): 'success' | 'failed' | 'reversed' | undefined {
  if (status === 'success') return 'success';
  if (status === 'reversed') return 'reversed';
  if (status === 'failed' || status === 'abandoned') return 'failed';
  return undefined;
}

// What we store on payout_transfers (pending | success | failed | reversed). Paystack can also
// answer otp/received/queued at initiation; those are still in flight, so they store as pending.
function storedTransferStatus(status: string): 'pending' | 'success' | 'failed' | 'reversed' {
  return terminalTransferStatus(status) ?? 'pending';
}

function transferCodeFrom(payload: Record<string, unknown>, fallback: string): string {
  const data = payload.data;
  if (typeof data === 'object' && data !== null && 'transfer_code' in data) {
    const code = (data as { transfer_code?: unknown }).transfer_code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return fallback;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract,
    @Inject(PayoutRepository) private readonly repository: PayoutRepositoryContract
  ) {}

  async getPayoutDestination(settlementId: string): Promise<PayoutDestination> {
    const context = await this.repository.findPayoutContext(settlementId);
    if (context === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Settlement was not found.'
      });
    }

    if (context.recipientCode === null) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Beneficiary has no payout bank account on file.'
      });
    }

    const details = await this.paystack.fetchTransferRecipient(context.recipientCode);
    return {
      settlementId,
      payableKobo: context.payableKobo,
      accountNumber: details.accountNumber,
      accountName: details.accountName,
      bankName: details.bankName,
      bankCode: details.bankCode
    };
  }

  /**
   * Initiate (or return the in-flight/completed) Paystack transfer for a settlement.
   * initiatedBy is the admin user id for a manual `POST /:id/pay`, or null for the pay-run.
   * A per-attempt reference (`<settlementId>-a<attempt>`) gives Paystack a fresh reference on
   * every retry; a settlement with a pending/successful transfer is never re-paid.
   */
  async payToSettlement(
    settlementId: string,
    initiatedBy: string | null
  ): Promise<PayoutTransferRecord> {
    if (!this.env.get('PAYOUTS_ENABLED')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Automated payouts are disabled.'
      });
    }

    const active = await this.repository.findActiveTransfer(settlementId);
    if (active !== undefined) {
      return active;
    }

    const context = await this.repository.findPayoutContext(settlementId);
    if (context === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Settlement payout destination was not found.'
      });
    }

    if (context.recipientCode === null) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message:
          'Settlement beneficiary has no Paystack transfer recipient. Provision payout bank details first.'
      });
    }

    const attempt = await this.repository.nextAttempt(settlementId);
    const reference = `${settlementId}-a${String(attempt)}`;

    const transfer = await this.paystack.initiateTransfer({
      amountKobo: context.payableKobo,
      recipientCode: context.recipientCode,
      reference,
      reason: `Settlement ${settlementId}`
    });

    return this.recordAndSettle({
      settlementId,
      attempt,
      reference,
      amountKobo: context.payableKobo,
      providerTransferCode: transfer.transferCode,
      status: storedTransferStatus(transfer.status),
      initiatedBy,
      providerPayload: transfer.providerPayload
    });
  }

  /**
   * Pay an on-demand withdrawal (a fresh settlement, so attempt 1) right away.
   *
   * Never pays twice: when the initiate call fails, Paystack is asked whether the transfer
   * exists anyway (a timeout can hide a success). Only when Paystack answers that it has no
   * such transfer is the withdrawal cancelled, which returns its earnings to the balance. When
   * the outcome is unknown (network failure) the withdrawal stays approved and is returned as
   * undefined: "processing", picked up by the pay-run with the same reference, which Paystack
   * dedupes.
   */
  async payWithdrawal(
    settlementId: string,
    initiatedBy: string
  ): Promise<PayoutTransferRecord | undefined> {
    try {
      return await this.payToSettlement(settlementId, initiatedBy);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown payout failure';
      if (!(error instanceof HttpException)) {
        this.logger.warn(`Withdrawal ${settlementId} outcome unknown, left processing: ${reason}`);
        return undefined;
      }

      const reference = `${settlementId}-a1`;
      let fetched;
      try {
        fetched = await this.paystack.fetchTransfer(reference);
      } catch (verifyError) {
        if (!(verifyError instanceof HttpException)) {
          this.logger.warn(
            `Withdrawal ${settlementId} outcome unknown, left processing: ${reason}`
          );
          return undefined;
        }
        this.logger.warn(`Withdrawal ${settlementId} rejected by Paystack, released: ${reason}`);
        await this.repository.cancelOnDemandSettlement(settlementId);
        throw new ServiceUnavailableException({
          code: ErrorCodes.PAYOUT_UNAVAILABLE,
          message:
            'Your withdrawal could not be sent right now. Your balance is unchanged; please try again shortly.'
        });
      }

      // Paystack has the transfer after all: record it so the webhook and reconcile sweep own it.
      const context = await this.repository.findPayoutContext(settlementId);
      return this.recordAndSettle({
        settlementId,
        attempt: 1,
        reference,
        amountKobo: context?.payableKobo ?? 0,
        providerTransferCode: transferCodeFrom(fetched.providerPayload, reference),
        status: storedTransferStatus(fetched.status),
        initiatedBy,
        providerPayload: fetched.providerPayload
      });
    }
  }

  // Record the transfer row; a transfer that is already terminal at initiation (Paystack can
  // answer success or failed synchronously) is reconciled at once instead of waiting for the
  // webhook, so the settlement shows paid, or an on-demand withdrawal is released, immediately.
  private async recordAndSettle(input: RecordTransferInput): Promise<PayoutTransferRecord> {
    const record = await this.repository.recordTransfer(input);
    if (record.status !== 'pending') {
      await this.repository.applyReconcile(
        record.reference,
        record.status as 'success' | 'failed' | 'reversed',
        input.providerPayload
      );
    }
    return record;
  }

  /**
   * The scheduled pay-run. Selects eligible settlements via the SQL invariant function and
   * initiates one transfer each. Best-effort per settlement so one bad row never blocks the
   * rest. A no-op (never touching the database) when PAYOUTS_ENABLED is off.
   */
  async runPayouts(limit = 100): Promise<{ selected: number; initiated: number; failed: number }> {
    if (!this.env.get('PAYOUTS_ENABLED')) {
      this.logger.log('runPayouts skipped: PAYOUTS_ENABLED is off');
      return { selected: 0, initiated: 0, failed: 0 };
    }

    const guardrails = await this.repository.getPayoutGuardrails();
    const ids = await this.repository.selectPayableSettlements(guardrails, limit);

    let initiated = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.payToSettlement(id, null);
        initiated += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'unknown payout failure';
        this.logger.warn(`Payout failed for settlement ${id}: ${message}`);
      }
    }

    this.logger.log(
      `Pay-run: selected ${String(ids.length)}, initiated ${String(initiated)}, failed ${String(failed)}`
    );
    return { selected: ids.length, initiated, failed };
  }

  /**
   * Active reconcile fallback for missed/late transfer webhooks. Verifies each still-pending
   * transfer against Paystack and applies a terminal status. Best-effort per row.
   */
  async reconcilePendingPayouts(options?: {
    graceSeconds?: number;
    limit?: number;
  }): Promise<{ scanned: number; reconciled: number }> {
    const graceSeconds = options?.graceSeconds ?? 900;
    const limit = options?.limit ?? 100;

    let pending;
    try {
      pending = await this.repository.listPendingTransfers(graceSeconds, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Could not load pending transfers for reconciliation: ${message}`);
      return { scanned: 0, reconciled: 0 };
    }

    let reconciled = 0;
    for (const transfer of pending) {
      try {
        const fetched = await this.paystack.fetchTransfer(transfer.reference);
        const status = terminalTransferStatus(fetched.status);
        if (status === undefined) continue; // still pending/otp — leave for a later sweep
        await this.repository.applyReconcile(transfer.reference, status, fetched.providerPayload);
        reconciled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Transfer reconcile failed for ${transfer.reference}: ${message}`);
      }
    }

    this.logger.log(
      `Transfer reconcile sweep: scanned ${String(pending.length)}, reconciled ${String(reconciled)}`
    );
    return { scanned: pending.length, reconciled };
  }

  /** Admin queue: keyset-paginated payout transfers, filterable by status or needs_admin. */
  async listTransfers(input: {
    status?: string;
    limit: number;
    cursor?: string;
  }): Promise<PayoutTransferPage> {
    const guardrails = await this.repository.getPayoutGuardrails();
    return this.repository.listTransfers({
      maxAttempts: guardrails.maxAttempts,
      limit: input.limit,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor })
    });
  }

  getTransfer(id: string): Promise<PayoutTransferListItem | undefined> {
    return this.repository.findTransferById(id);
  }
}
