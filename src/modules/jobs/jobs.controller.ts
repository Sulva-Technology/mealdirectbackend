import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { OutboxListQueryDto, ProcessOutboxDto } from './dto/jobs.dto.js';
import { JobsService } from './jobs.service.js';
import type { JobsRecord, OutboxProcessResult, SystemSummary } from './jobs.types.js';

@ApiTags('admin-jobs')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get('system')
  @ApiOkResponse({ description: 'Worker and outbox operational summary.' })
  async getSystemSummary(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<SystemSummary>> {
    return createSuccessEnvelope(await this.jobs.getSystemSummary(actor));
  }

  @Get('jobs/outbox')
  @ApiOkResponse({ description: 'Outbox event list for admin operations.' })
  async listOutboxEvents(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: OutboxListQueryDto
  ): Promise<ListEnvelope<JobsRecord>> {
    const items = await this.jobs.listOutboxEvents(actor, query);
    return createListEnvelope(items, {
      hasMore: false,
      limit: query.limit ?? 20
    });
  }

  @Post('jobs/outbox/process')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Claims currently available outbox events for a worker.' })
  async processOutboxEvents(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: ProcessOutboxDto
  ): Promise<SuccessEnvelope<OutboxProcessResult>> {
    return createSuccessEnvelope(await this.jobs.claimAvailableOutboxEvents(actor, input));
  }
}
