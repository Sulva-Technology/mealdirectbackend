import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PayoutService } from './payout.service.js';
import { WithdrawalsRepository } from './withdrawals.repository.js';
import type {
  WithdrawalBalance,
  WithdrawalBeneficiary,
  WithdrawalResult,
  WithdrawalsRepositoryContract
} from './withdrawals.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/**
 * On-demand withdrawals for vendors and riders: see what can be withdrawn, then pay it out
 * immediately through Paystack. The money rules (hold, minimum, which order lines are still
 * unsettled, one withdrawal at a time) live in public.request_withdrawal.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(WithdrawalsRepository) private readonly repository: WithdrawalsRepositoryContract,
    @Inject(PayoutService) private readonly payouts: PayoutService
  ) {}

  async getBalance(actor: AuthenticatedActor): Promise<WithdrawalBalance> {
    const balance = await this.repository.getBalance(await this.resolveBeneficiary(actor));
    return {
      ...balance,
      enabled: balance.enabled && this.payoutsEnabled(),
      canWithdraw:
        balance.enabled &&
        this.payoutsEnabled() &&
        balance.payoutAccountReady &&
        balance.availableKobo >= balance.minimumKobo
    };
  }

  async requestWithdrawal(actor: AuthenticatedActor): Promise<WithdrawalResult> {
    const beneficiary = await this.resolveBeneficiary(actor);
    if (!this.payoutsEnabled()) {
      throw forbidden('Withdrawals are temporarily unavailable.');
    }

    const request = await this.repository.requestWithdrawal(beneficiary, actor.userId);
    if (request.outcome !== 'created') {
      if (request.outcome === 'disabled') {
        throw forbidden('Withdrawals are temporarily unavailable.');
      }
      if (request.outcome === 'no_payout_account') {
        throw badRequest(
          'Add a payout bank account and wait for it to be approved before withdrawing.'
        );
      }
      throw badRequest(
        request.amountKobo <= 0
          ? 'You have nothing available to withdraw yet.'
          : `The minimum withdrawal is ${naira(request.minimumKobo)}; you have ${naira(request.amountKobo)} available.`
      );
    }

    const transfer = await this.payouts.payWithdrawal(request.settlementId, actor.userId);
    if (transfer?.status === 'failed' || transfer?.status === 'reversed') {
      // Paystack failed it on the spot; reconcile already returned the earnings to the balance.
      throw new ServiceUnavailableException({
        code: ErrorCodes.PAYOUT_UNAVAILABLE,
        message:
          'Your withdrawal could not be sent right now. Your balance is unchanged; please try again shortly.'
      });
    }
    return {
      settlementId: request.settlementId,
      amountKobo: request.amountKobo,
      status: transfer === undefined ? 'processing' : (transfer.status as 'pending' | 'success'),
      reference: transfer?.reference ?? null
    };
  }

  private payoutsEnabled(): boolean {
    return this.env.get('PAYOUTS_ENABLED');
  }

  private async resolveBeneficiary(actor: AuthenticatedActor): Promise<WithdrawalBeneficiary> {
    if (actor.role === 'vendor') {
      if (actor.vendorId === undefined || actor.vendorId.length === 0) {
        throw forbidden('Vendor access is required.');
      }
      if (!(await this.repository.hasVendorAccess(actor.vendorId, actor.userId))) {
        throw forbidden('Vendor access is required.');
      }
      return { vendorId: actor.vendorId };
    }

    if (actor.role === 'rider') {
      const riderId = await this.repository.findRiderIdForUser(actor.userId, actor.riderId);
      if (riderId === undefined) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Rider profile was not found.'
        });
      }
      return { riderId };
    }

    throw forbidden('Vendor or rider access is required.');
  }
}
