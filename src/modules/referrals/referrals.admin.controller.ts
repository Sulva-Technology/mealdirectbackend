import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createSuccessEnvelope } from '../../common/api/response.js';
import type { SuccessEnvelope } from '../../common/api/response.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReferralAnalyticsQueryDto } from './dto/referral.dto.js';
import { ReferralsService } from './referrals.service.js';
import type { ReferralAnalytics } from './referrals.types.js';

@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Super admin role is required.' })
@Controller('admin/referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('super_admin')
export class ReferralsAdminController {
  constructor(@Inject(ReferralsService) private readonly referrals: ReferralsService) {}

  @Get('analytics')
  @ApiOkResponse({
    description: 'Per-referrer breakdown of how much their referred users have spent (paid orders).'
  })
  async analytics(
    @Query() query: ReferralAnalyticsQueryDto
  ): Promise<SuccessEnvelope<ReferralAnalytics>> {
    return createSuccessEnvelope(
      await this.referrals.getAnalytics({
        campusId: query.campusId,
        from: query.from,
        to: query.to,
        limit: query.limit ?? 50
      })
    );
  }
}
