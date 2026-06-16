import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
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
  VendorSettlementDetailEnvelopeDto,
  VendorSettlementIdParamDto,
  VendorSettlementListEnvelopeDto,
  VendorSettlementListQueryDto
} from './dto/vendor-settlement.dto.js';
import { SettlementsService } from './settlements.service.js';
import type { SettlementDetail, SettlementSummary } from './settlements.types.js';

@ApiTags('vendor-settlements')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor role and vendor membership are required.' })
@Controller('vendor/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorSettlementsController {
  constructor(@Inject(SettlementsService) private readonly settlements: SettlementsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Cursor-paginated settlements for the authenticated vendor.',
    type: VendorSettlementListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid filters or cursor.' })
  async listSettlements(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: VendorSettlementListQueryDto
  ): Promise<ListEnvelope<SettlementSummary>> {
    const page = await this.settlements.listVendorSettlements(actor, query);
    return createListEnvelope(page.items, page.pagination);
  }

  @Get(':id')
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({
    description: 'Settlement detail with immutable settlement lines.',
    type: VendorSettlementDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Settlement not found for this vendor.' })
  async getSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorSettlementIdParamDto
  ): Promise<SuccessEnvelope<SettlementDetail>> {
    return createSuccessEnvelope(await this.settlements.getVendorSettlement(actor, params.id));
  }
}
