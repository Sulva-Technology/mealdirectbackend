import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createSuccessEnvelope } from '../../common/api/response.js';
import type { SuccessEnvelope } from '../../common/api/response.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RedeemReferralDto } from './dto/referral.dto.js';
import { ReferralsService } from './referrals.service.js';
import type { MyReferral, RedeemReferralResult } from './referrals.types.js';

@ApiTags('referrals')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(@Inject(ReferralsService) private readonly referrals: ReferralsService) {}

  @Get('me')
  @ApiOkResponse({
    description: 'The current user referral code and how many users they referred.'
  })
  async me(@CurrentActor() actor: AuthenticatedActor): Promise<SuccessEnvelope<MyReferral>> {
    return createSuccessEnvelope(await this.referrals.getMyReferral(actor));
  }

  @Post('redeem')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Binds the current user to the referrer behind the code.' })
  @ApiBadRequestResponse({ description: 'Invalid, unknown, or self-owned referral code.' })
  @ApiConflictResponse({
    description: 'A code was already redeemed, or onboarding is already complete.'
  })
  async redeem(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: RedeemReferralDto
  ): Promise<SuccessEnvelope<RedeemReferralResult>> {
    return createSuccessEnvelope(await this.referrals.redeem(actor, input.code));
  }
}
