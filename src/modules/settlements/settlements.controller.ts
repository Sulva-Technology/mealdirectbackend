import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  GenerateSettlementDto,
  RiderSettlementParamsDto,
  VendorSettlementParamsDto
} from './dto/generate-settlement.dto.js';
import { PayoutService } from './payout.service.js';
import type { PayoutTransferRecord } from './payout.types.js';
import { SettlementsService } from './settlements.service.js';

@ApiTags('settlements')
@ApiBearerAuth('supabaseAuth')
@Controller('settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('super_admin')
export class SettlementsController {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(PayoutService) private readonly payouts: PayoutService
  ) {}

  @Post('vendors/:vendorId/daily')
  @ApiCreatedResponse({ description: 'Vendor daily settlement was generated idempotently.' })
  generateVendorDailySettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorSettlementParamsDto,
    @Body() input: GenerateSettlementDto
  ): Promise<{ settlementId: string }> {
    return this.settlements.generateVendorDailySettlement(
      actor,
      params.vendorId,
      input.settlementDate
    );
  }

  @Post('riders/:riderId/daily')
  @ApiCreatedResponse({ description: 'Rider daily settlement was generated idempotently.' })
  generateRiderDailySettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: RiderSettlementParamsDto,
    @Body() input: GenerateSettlementDto
  ): Promise<{ settlementId: string }> {
    return this.settlements.generateRiderDailySettlement(
      actor,
      params.riderId,
      input.settlementDate
    );
  }

  @Post(':settlementId/pay')
  @ApiOkResponse({
    description: 'Initiated (or returned the existing) automated payout transfer for a settlement.'
  })
  paySettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('settlementId') settlementId: string
  ): Promise<PayoutTransferRecord> {
    return this.payouts.payToSettlement(actor, settlementId);
  }
}
