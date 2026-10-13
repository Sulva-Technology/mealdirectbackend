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
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AnalyticsService } from './analytics.service.js';
import type { SignupFunnel } from './analytics.types.js';
import { SignupFunnelQueryDto } from './dto/analytics.dto.js';

@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AnalyticsAdminController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get('funnel')
  @ApiOkResponse({
    description:
      'Signup funnel (campus link opened → first paid order) plus a per-campus breakdown. Campus admins only see their own campus.'
  })
  async funnel(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: SignupFunnelQueryDto
  ): Promise<SuccessEnvelope<SignupFunnel>> {
    return createSuccessEnvelope(
      await this.analytics.getSignupFunnel(actor, {
        ...(query.campusId === undefined ? {} : { campusId: query.campusId }),
        ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
        ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo })
      })
    );
  }
}
