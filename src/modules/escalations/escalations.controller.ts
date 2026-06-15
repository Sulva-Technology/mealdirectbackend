import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { OrderIdParamDto } from '../orders/dto/order-api.dto.js';
import {
  CreateEscalationDto,
  EscalationEnvelopeDto,
  EscalationListEnvelopeDto
} from './dto/escalation.dto.js';
import { EscalationsService } from './escalations.service.js';
import type { EscalationRecord } from './escalations.types.js';

@ApiTags('escalations')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('customer')
export class CustomerEscalationsController {
  constructor(@Inject(EscalationsService) private readonly escalations: EscalationsService) {}

  @Get(':orderId/escalations')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Customer-visible escalations for an owned order.',
    type: EscalationListEnvelopeDto
  })
  async listEscalations(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto
  ): Promise<ListEnvelope<EscalationRecord>> {
    const escalations = await this.escalations.listEscalations(actor, params.orderId);
    return createListEnvelope(escalations, { hasMore: false, limit: escalations.length });
  }

  @Post(':orderId/escalations')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiCreatedResponse({
    description: 'Opened or existing customer escalation for an owned eligible order.',
    type: EscalationEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid escalation input or ineligible order.' })
  async openEscalation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto,
    @Body() input: CreateEscalationDto
  ): Promise<SuccessEnvelope<EscalationRecord>> {
    return createSuccessEnvelope(
      await this.escalations.openEscalation(actor, params.orderId, input)
    );
  }
}
