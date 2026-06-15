import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreateRiderIssueDto,
  RiderAssignmentDetailEnvelopeDto,
  RiderAssignmentIdParamDto,
  RiderAssignmentListEnvelopeDto,
  RiderAssignmentListQueryDto,
  RiderEarningsEnvelopeDto,
  RiderEarningsQueryDto,
  RiderIssueEnvelopeDto,
  RiderOrderDetailEnvelopeDto,
  RiderOrderIdParamDto,
  RiderProfileEnvelopeDto,
  RiderProfileUpdateDto,
  RiderSettlementDetailEnvelopeDto,
  RiderSettlementIdParamDto,
  RiderSettlementListEnvelopeDto,
  RiderSettlementListQueryDto
} from './dto/rider.dto.js';
import { RidersService } from './riders.service.js';
import type {
  RiderAssignmentDetail,
  RiderAssignmentSummary,
  RiderEarningsSummary,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderProfile,
  RiderSettlementDetail,
  RiderSettlementSummary
} from './riders.types.js';

@ApiTags('rider')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Verified active rider access is required.' })
@Controller('rider')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('rider')
export class RidersController {
  constructor(@Inject(RidersService) private readonly riders: RidersService) {}

  @Get('profile')
  @ApiOkResponse({ description: 'Authenticated rider profile.', type: RiderProfileEnvelopeDto })
  @ApiNotFoundResponse({ description: 'Rider profile not found.' })
  async getProfile(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<RiderProfile>> {
    return createSuccessEnvelope(await this.riders.getProfile(actor));
  }

  @Patch('profile')
  @ApiOkResponse({ description: 'Updated rider profile.', type: RiderProfileEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid profile input.' })
  async updateProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: RiderProfileUpdateDto
  ): Promise<SuccessEnvelope<RiderProfile>> {
    return createSuccessEnvelope(await this.riders.updateProfile(actor, input));
  }

  @Get('assignments')
  @ApiOkResponse({
    description: 'Cursor-paginated assignments for the authenticated rider.',
    type: RiderAssignmentListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid filters or cursor.' })
  async listAssignments(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: RiderAssignmentListQueryDto
  ): Promise<ListEnvelope<RiderAssignmentSummary>> {
    const page = await this.riders.listAssignments(actor, query);
    return createListEnvelope(page.items, page.pagination);
  }

  @Get('assignments/:assignmentId')
  @ApiParam({ format: 'uuid', name: 'assignmentId', type: String })
  @ApiOkResponse({
    description: 'Assignment detail with order manifest.',
    type: RiderAssignmentDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Assignment not found for this rider.' })
  async getAssignment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderAssignmentIdParamDto
  ): Promise<SuccessEnvelope<RiderAssignmentDetail>> {
    return createSuccessEnvelope(await this.riders.getAssignment(actor, params.assignmentId));
  }

  @Post('assignments/:assignmentId/accept')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'assignmentId', type: String })
  @ApiOkResponse({ description: 'Assignment accepted.', type: RiderAssignmentDetailEnvelopeDto })
  async acceptAssignment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderAssignmentIdParamDto
  ): Promise<SuccessEnvelope<RiderAssignmentDetail>> {
    return createSuccessEnvelope(await this.riders.acceptAssignment(actor, params.assignmentId));
  }

  @Post('assignments/:assignmentId/picked-up')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'assignmentId', type: String })
  @ApiOkResponse({
    description: 'Assignment marked picked up.',
    type: RiderAssignmentDetailEnvelopeDto
  })
  async markAssignmentPickedUp(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderAssignmentIdParamDto
  ): Promise<SuccessEnvelope<RiderAssignmentDetail>> {
    return createSuccessEnvelope(
      await this.riders.markAssignmentPickedUp(actor, params.assignmentId)
    );
  }

  @Get('orders/:orderId')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Delivery order detail for an assigned rider.',
    type: RiderOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this rider.' })
  async getOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderOrderIdParamDto
  ): Promise<SuccessEnvelope<RiderOrderDetail>> {
    return createSuccessEnvelope(await this.riders.getOrder(actor, params.orderId));
  }

  @Post('orders/:orderId/out-for-delivery')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({ description: 'Order marked out for delivery.', type: RiderOrderDetailEnvelopeDto })
  async markOrderOutForDelivery(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderOrderIdParamDto
  ): Promise<SuccessEnvelope<RiderOrderDetail>> {
    return createSuccessEnvelope(
      await this.riders.markOrderOutForDelivery(actor, params.orderId)
    );
  }

  @Post('orders/:orderId/delivered')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({ description: 'Order marked delivered.', type: RiderOrderDetailEnvelopeDto })
  async markOrderDelivered(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderOrderIdParamDto
  ): Promise<SuccessEnvelope<RiderOrderDetail>> {
    return createSuccessEnvelope(await this.riders.markOrderDelivered(actor, params.orderId));
  }

  @Post('orders/:orderId/issues')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({ description: 'Delivery issue recorded.', type: RiderIssueEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid issue payload.' })
  async createIssue(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderOrderIdParamDto,
    @Body() input: CreateRiderIssueDto
  ): Promise<SuccessEnvelope<RiderIssueRecord>> {
    return createSuccessEnvelope(await this.riders.createIssue(actor, params.orderId, input));
  }

  @Get('earnings')
  @ApiOkResponse({
    description: 'Rider earnings grouped by assignment batch.',
    type: RiderEarningsEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid earnings date range.' })
  async getEarnings(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: RiderEarningsQueryDto
  ): Promise<SuccessEnvelope<RiderEarningsSummary>> {
    return createSuccessEnvelope(await this.riders.getEarnings(actor, query));
  }

  @Get('settlements')
  @ApiOkResponse({
    description: 'Cursor-paginated rider settlement list.',
    type: RiderSettlementListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid settlement filters or cursor.' })
  async listSettlements(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: RiderSettlementListQueryDto
  ): Promise<ListEnvelope<RiderSettlementSummary>> {
    const page = await this.riders.listSettlements(actor, query);
    return createListEnvelope(page.items, page.pagination);
  }

  @Get('settlements/:id')
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({
    description: 'Rider settlement detail with settlement lines.',
    type: RiderSettlementDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Settlement not found for this rider.' })
  async getSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderSettlementIdParamDto
  ): Promise<SuccessEnvelope<RiderSettlementDetail>> {
    return createSuccessEnvelope(await this.riders.getSettlement(actor, params.id));
  }
}
