import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  BatchDetailEnvelopeDto,
  BatchIdParamDto,
  BatchListEnvelopeDto,
  BatchListQueryDto
} from './dto/batches.dto.js';
import { BatchesService } from './batches.service.js';
import type { BatchDetail, BatchSummary } from './batches.types.js';

@ApiTags('vendor-batches')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor role and vendor membership are required.' })
@Controller('vendor/batches')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorBatchesController {
  constructor(@Inject(BatchesService) private readonly batchesService: BatchesService) {}

  @Get()
  @ApiOkResponse({
    description: 'List of delivery batches associated with the authenticated vendor.',
    type: BatchListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid query filters.' })
  async listBatches(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: BatchListQueryDto
  ): Promise<ListEnvelope<BatchSummary>> {
    const batches = await this.batchesService.listBatches(actor, query);
    return createListEnvelope(batches, {
      hasMore: false,
      limit: query.limit ?? 20
    });
  }

  @Get(':batchId')
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiOkResponse({
    description: 'Detailed summary of a single vendor batch, including its orders.',
    type: BatchDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Batch not found for this vendor.' })
  async getBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: BatchIdParamDto
  ): Promise<SuccessEnvelope<BatchDetail>> {
    return createSuccessEnvelope(await this.batchesService.getBatch(actor, params.batchId));
  }

  @Post(':batchId/pickup')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiOkResponse({
    description: 'Batch ready for pickup, assignments updated to picked_up.',
    type: BatchDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Batch not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid batch transition.' })
  async pickupBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: BatchIdParamDto
  ): Promise<SuccessEnvelope<BatchDetail>> {
    return createSuccessEnvelope(await this.batchesService.pickupBatch(actor, params.batchId));
  }

  @Post(':batchId/ready-for-pickup')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiOkResponse({
    description: 'Batch ready for pickup, assignments updated to picked_up.',
    type: BatchDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Batch not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid batch transition.' })
  async readyForPickupBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: BatchIdParamDto
  ): Promise<SuccessEnvelope<BatchDetail>> {
    return createSuccessEnvelope(await this.batchesService.pickupBatch(actor, params.batchId));
  }
}
