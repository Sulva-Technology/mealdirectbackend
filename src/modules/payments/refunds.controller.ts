import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
  AdminRefundEnvelopeDto,
  AdminRefundListEnvelopeDto,
  AdminRefundListQueryDto,
  RefundIdParamDto,
  RefundResolutionDto
} from './dto/refund-admin.dto.js';
import { RefundsService } from './refunds.service.js';
import type { AdminRefundRecord } from './refunds.types.js';

@ApiTags('admin-refunds')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class RefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Refund records scoped by campus for campus admins.',
    type: AdminRefundListEnvelopeDto
  })
  async listRefunds(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminRefundListQueryDto
  ): Promise<ListEnvelope<AdminRefundRecord>> {
    const result = await this.refunds.listRefunds(
      actor,
      { ...(query.status === undefined ? {} : { status: query.status }) },
      {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      }
    );
    return createListEnvelope(result.items, {
      hasMore: result.hasMore,
      limit: result.limit,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor })
    });
  }

  @Get(':refundId')
  @ApiParam({ format: 'uuid', name: 'refundId', type: String })
  @ApiOkResponse({ description: 'Refund detail.', type: AdminRefundEnvelopeDto })
  async getRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RefundIdParamDto
  ): Promise<SuccessEnvelope<AdminRefundRecord>> {
    return createSuccessEnvelope(await this.refunds.getRefund(actor, params.refundId));
  }

  @Post(':refundId/retry')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'refundId', type: String })
  @ApiOkResponse({ description: 'Retries a failed refund against Paystack.', type: AdminRefundEnvelopeDto })
  async retryRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RefundIdParamDto
  ): Promise<SuccessEnvelope<AdminRefundRecord>> {
    return createSuccessEnvelope(await this.refunds.retryRefund(actor, params.refundId));
  }

  @Post(':refundId/resolve')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'refundId', type: String })
  @ApiOkResponse({ description: 'Records a manual refund resolution.', type: AdminRefundEnvelopeDto })
  async resolveRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RefundIdParamDto,
    @Body() input: RefundResolutionDto
  ): Promise<SuccessEnvelope<AdminRefundRecord>> {
    return createSuccessEnvelope(
      await this.refunds.resolveRefund(actor, params.refundId, {
        status: input.status,
        ...(input.resolutionNote === undefined ? {} : { resolutionNote: input.resolutionNote }),
        ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason })
      })
    );
  }

  @Post(':refundId/approve')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'refundId', type: String })
  @ApiOkResponse({ description: 'Approves a requested refund.', type: AdminRefundEnvelopeDto })
  async approveRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RefundIdParamDto
  ): Promise<SuccessEnvelope<AdminRefundRecord>> {
    return createSuccessEnvelope(await this.refunds.decideRefund(actor, params.refundId, 'approve'));
  }

  @Post(':refundId/reject')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'refundId', type: String })
  @ApiOkResponse({ description: 'Rejects a requested refund.', type: AdminRefundEnvelopeDto })
  async rejectRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RefundIdParamDto
  ): Promise<SuccessEnvelope<AdminRefundRecord>> {
    return createSuccessEnvelope(await this.refunds.decideRefund(actor, params.refundId, 'reject'));
  }
}
