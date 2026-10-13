import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SupabaseJwtService } from '../auth/supabase-jwt.service.js';
import { AnalyticsService } from './analytics.service.js';
import { RecordFunnelEventDto } from './dto/analytics.dto.js';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(SupabaseJwtService) private readonly jwt: SupabaseJwtService
  ) {}

  @Post('events')
  @HttpCode(204)
  @ApiNoContentResponse({
    description:
      'Records one signup funnel step. Public so pre-signup steps can be counted; a valid bearer token, when sent, links the step to the signed-in user.'
  })
  @ApiBadRequestResponse({ description: 'Unknown event name or malformed ids.' })
  async recordEvent(
    @Req() request: FastifyRequest,
    @Body() input: RecordFunnelEventDto
  ): Promise<void> {
    const userId = await this.optionalUserId(request);
    await this.analytics.recordEvent({
      event: input.event,
      anonymousId: input.anonymousId,
      ...(userId === undefined ? {} : { userId }),
      ...(input.campusId === undefined ? {} : { campusId: input.campusId }),
      ...(input.campusSlug === undefined ? {} : { campusSlug: input.campusSlug })
    });
  }

  /** A missing, expired or invalid token records the step anonymously instead of failing. */
  private async optionalUserId(request: FastifyRequest): Promise<string | undefined> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return undefined;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      return undefined;
    }
    try {
      return (await this.jwt.verifyToken(token)).userId;
    } catch {
      return undefined;
    }
  }
}
