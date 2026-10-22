import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createSuccessEnvelope } from '../../common/api/response.js';
import type { SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { WithdrawalBalanceEnvelopeDto, WithdrawalResultEnvelopeDto } from './dto/withdrawal.dto.js';
import { WithdrawalsService } from './withdrawals.service.js';
import type { WithdrawalBalance, WithdrawalResult } from './withdrawals.types.js';

const balanceDescription =
  'Withdrawable balance: available now, still in the hold window, and on the way to the bank.';
const requestDescription =
  'Withdraw the whole available balance to the approved payout bank account immediately.';
const rejectedDescription =
  'Nothing to withdraw, below the minimum, or no approved payout bank account.';
const unavailableDescription =
  'Paystack did not accept the transfer; the balance is unchanged and the request can be retried.';

@ApiTags('vendor-withdrawals')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor access is required, or withdrawals are off.' })
@Controller('vendor/withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorWithdrawalsController {
  constructor(@Inject(WithdrawalsService) private readonly withdrawals: WithdrawalsService) {}

  @Get('balance')
  @ApiOkResponse({ description: balanceDescription, type: WithdrawalBalanceEnvelopeDto })
  async getBalance(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<WithdrawalBalance>> {
    return createSuccessEnvelope(await this.withdrawals.getBalance(actor));
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ description: requestDescription, type: WithdrawalResultEnvelopeDto })
  @ApiBadRequestResponse({ description: rejectedDescription })
  @ApiServiceUnavailableResponse({ description: unavailableDescription })
  async requestWithdrawal(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<WithdrawalResult>> {
    return createSuccessEnvelope(await this.withdrawals.requestWithdrawal(actor));
  }
}

@ApiTags('rider-withdrawals')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Rider access is required, or withdrawals are off.' })
@Controller('rider/withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('rider')
export class RiderWithdrawalsController {
  constructor(@Inject(WithdrawalsService) private readonly withdrawals: WithdrawalsService) {}

  @Get('balance')
  @ApiOkResponse({ description: balanceDescription, type: WithdrawalBalanceEnvelopeDto })
  async getBalance(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<WithdrawalBalance>> {
    return createSuccessEnvelope(await this.withdrawals.getBalance(actor));
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ description: requestDescription, type: WithdrawalResultEnvelopeDto })
  @ApiBadRequestResponse({ description: rejectedDescription })
  @ApiServiceUnavailableResponse({ description: unavailableDescription })
  async requestWithdrawal(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<WithdrawalResult>> {
    return createSuccessEnvelope(await this.withdrawals.requestWithdrawal(actor));
  }
}
