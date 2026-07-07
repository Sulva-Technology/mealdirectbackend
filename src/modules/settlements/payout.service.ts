import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaystackClient } from '../payments/paystack.client.js';
import type { PaystackClientContract } from '../payments/payments.types.js';
import { PayoutRepository } from './payout.repository.js';
import type {
  PayoutDestination,
  PayoutRepositoryContract,
  PayoutTransferRecord
} from './payout.types.js';

@Injectable()
export class PayoutService {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract,
    @Inject(PayoutRepository) private readonly repository: PayoutRepositoryContract
  ) {}

  /**
   * Resolve the beneficiary's bank account for a settlement so an admin can pay manually.
   * The full account number is never stored locally (only masked), so it is fetched back
   * from Paystack using the recipient code provisioned when the bank details were captured.
   * Intentionally NOT gated on PAYOUTS_ENABLED — this is the manual-payment fallback.
   */
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

  async payToSettlement(
    actor: AuthenticatedActor,
    settlementId: string
  ): Promise<PayoutTransferRecord> {
    if (!this.env.get('PAYOUTS_ENABLED')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Automated payouts are disabled.'
      });
    }

    const existing = await this.repository.findTransferBySettlement(settlementId);
    if (existing !== undefined) {
      return existing;
    }

    const context = await this.repository.findPayoutContext(settlementId);
    if (context === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Settlement payout destination was not found.'
      });
    }

    // The transfer recipient is provisioned when the beneficiary's bank details are
    // captured (the only point the full account number exists). A null code here means
    // the beneficiary has no usable payout destination — fail loud rather than send bad
    // data to Paystack.
    if (context.recipientCode === null) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message:
          'Settlement beneficiary has no Paystack transfer recipient. Provision payout bank details first.'
      });
    }

    const transfer = await this.paystack.initiateTransfer({
      amountKobo: context.payableKobo,
      recipientCode: context.recipientCode,
      reference: settlementId,
      reason: `Settlement ${settlementId}`
    });

    return this.repository.recordTransfer({
      settlementId,
      reference: settlementId,
      amountKobo: context.payableKobo,
      providerTransferCode: transfer.transferCode,
      status: transfer.status,
      initiatedBy: actor.userId,
      providerPayload: transfer.providerPayload
    });
  }
}
