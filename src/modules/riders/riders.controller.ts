import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
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
  ConfirmDeliveryDto,
  CreateRiderIssueDto,
  OnboardRiderDto,
  RiderAvailabilityDto,
  RiderAssignmentDetailEnvelopeDto,
  RiderAssignmentIdParamDto,
  RiderDeclineAssignmentDto,
  RiderAssignmentListEnvelopeDto,
  RiderAssignmentListQueryDto,
  RiderEarningsEnvelopeDto,
  RiderEarningsQueryDto,
  RiderIssueEnvelopeDto,
  RiderOnboardEnvelopeDto,
  RiderOrderDetailEnvelopeDto,
  RiderOrderIdParamDto,
  RiderPayoutAccountEnvelopeDto,
  RiderPayoutHistoryEnvelopeDto,
  RiderPayoutHistoryQueryDto,
  RiderProfileEnvelopeDto,
  RiderProfileUpdateDto,
  RiderSettlementDetailEnvelopeDto,
  RiderSettlementIdParamDto,
  RiderSettlementListEnvelopeDto,
  RiderSettlementListQueryDto,
  UpsertRiderPayoutAccountDto
} from './dto/rider.dto.js';
import type { RiderOnboardResult } from './riders.service.js';
import { RidersService } from './riders.service.js';
import type {
  RiderAssignmentDetail,
  RiderAssignmentSummary,
  RiderEarningsSummary,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderPayoutAccountView,
  RiderPayoutTransfer,
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

  @Post('onboard')
  @ApiCreatedResponse({
    description:
      'Provisions the rider record for the caller. The client must refresh its session afterwards to receive the rider_id claim. The rider starts pending and requires admin verification before delivery access.',
    type: RiderOnboardEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid onboarding input or unknown campus.' })
  @ApiConflictResponse({ description: 'This account is already linked to a rider.' })
  @ApiBody({ type: OnboardRiderDto })
  async onboard(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: OnboardRiderDto
  ): Promise<SuccessEnvelope<RiderOnboardResult>> {
    return createSuccessEnvelope(await this.riders.onboardRider(actor, input));
  }

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

  @Patch('availability')
  @ApiOkResponse({
    description: 'Updated rider availability flag.',
    type: RiderProfileEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid availability input.' })
  async setAvailability(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: RiderAvailabilityDto
  ): Promise<SuccessEnvelope<RiderProfile>> {
    return createSuccessEnvelope(await this.riders.setAvailability(actor, input.available));
  }

  @Get('payout-account')
  @ApiOkResponse({
    description: 'Current masked payout account snapshot, if configured.',
    type: RiderPayoutAccountEnvelopeDto
  })
  async getPayoutAccount(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<RiderPayoutAccountView | null>> {
    return createSuccessEnvelope(await this.riders.getPayoutAccount(actor));
  }

  @Put('payout-account')
  @Post('payout-account')
  @Patch('payout-account')
  @ApiOkResponse({
    description:
      'Provisions a Paystack transfer recipient from the full account number and stores a masked snapshot.',
    type: RiderPayoutAccountEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid payout account input.' })
  @ApiBody({ type: UpsertRiderPayoutAccountDto })
  async updatePayoutAccount(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpsertRiderPayoutAccountDto
  ): Promise<SuccessEnvelope<RiderPayoutAccountView>> {
    return createSuccessEnvelope(await this.riders.upsertPayoutAccount(actor, input));
  }

  @Post('payout-account/verify')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Re-attests the current payout account and refreshes its verification.',
    type: RiderPayoutAccountEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'No provisioned payout account to verify.' })
  async verifyPayoutAccount(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<RiderPayoutAccountView>> {
    return createSuccessEnvelope(await this.riders.verifyPayoutAccount(actor));
  }

  @Get('payout-history')
  @ApiOkResponse({
    description: 'Cursor-paginated rider payout transfer history.',
    type: RiderPayoutHistoryEnvelopeDto
  })
  async getPayoutHistory(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: RiderPayoutHistoryQueryDto
  ): Promise<ListEnvelope<RiderPayoutTransfer>> {
    const page = await this.riders.getPayoutHistory(actor, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, page.pagination);
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

  @Post('assignments/:assignmentId/decline')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'assignmentId', type: String })
  @ApiOkResponse({
    description: 'Assignment declined; the batch reopens for admin re-assignment.',
    type: RiderAssignmentDetailEnvelopeDto
  })
  async declineAssignment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderAssignmentIdParamDto,
    @Body() input: RiderDeclineAssignmentDto
  ): Promise<SuccessEnvelope<RiderAssignmentDetail>> {
    return createSuccessEnvelope(
      await this.riders.declineAssignment(actor, params.assignmentId, input.reason)
    );
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
  @ApiOkResponse({
    description: 'Order marked out for delivery.',
    type: RiderOrderDetailEnvelopeDto
  })
  async markOrderOutForDelivery(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderOrderIdParamDto
  ): Promise<SuccessEnvelope<RiderOrderDetail>> {
    return createSuccessEnvelope(await this.riders.markOrderOutForDelivery(actor, params.orderId));
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

  @Post('orders/confirm-delivery')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Order marked delivered via the customer hand-off code.',
    type: RiderOrderDetailEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid code payload.' })
  async confirmDeliveryByCode(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: ConfirmDeliveryDto
  ): Promise<SuccessEnvelope<RiderOrderDetail>> {
    return createSuccessEnvelope(await this.riders.confirmDeliveryByCode(actor, input.code));
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
