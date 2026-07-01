import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ReferralsRepository } from './referrals.repository.js';
import type {
  MyReferral,
  ReferralAnalytics,
  ReferralAnalyticsQuery,
  RedeemReferralResult,
  ReferralsRepositoryContract
} from './referrals.types.js';

@Injectable()
export class ReferralsService {
  constructor(
    @Inject(ReferralsRepository) private readonly repository: ReferralsRepositoryContract,
    @Inject(ProfilesService) private readonly profiles: ProfilesService
  ) {}

  async getMyReferral(actor: AuthenticatedActor): Promise<MyReferral> {
    await this.profiles.ensureProfile(actor);
    const [code, referredCount] = await Promise.all([
      this.repository.ensureReferralCode(actor.userId),
      this.repository.countReferred(actor.userId)
    ]);

    return { code, referredCount };
  }

  async redeem(actor: AuthenticatedActor, code: string): Promise<RedeemReferralResult> {
    await this.profiles.ensureProfile(actor);

    // Referrals bind at signup only: once onboarding is done the window has closed.
    if (await this.repository.isOnboardingComplete(actor.userId)) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Referral codes can only be redeemed before completing onboarding.'
      });
    }

    if (await this.repository.hasRedeemed(actor.userId)) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'A referral code has already been redeemed for this account.'
      });
    }

    const referrer = await this.repository.findReferrerByCode(code);
    if (referrer === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Referral code was not found.'
      });
    }

    if (referrer.id === actor.userId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'You cannot redeem your own referral code.'
      });
    }

    await this.repository.insertReferral(actor.userId, referrer.id, code);

    return { referrerId: referrer.id, code };
  }

  getAnalytics(query: ReferralAnalyticsQuery): Promise<ReferralAnalytics> {
    return this.repository.getAnalytics(query);
  }
}
