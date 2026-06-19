import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreatePromotionDto, ValidatePromotionDto } from './dto/promotion.dto.js';
import { PromotionsService } from './promotions.service.js';
import type { PromotionRecord, PromotionValidationResult } from './promotions.types.js';

@ApiTags('promotions')
@ApiBearerAuth('supabaseAuth')
@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(@Inject(PromotionsService) private readonly promotions: PromotionsService) {}

  @Post('validate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Validated the promotion code and returned the discount in kobo.' })
  validate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: ValidatePromotionDto
  ): Promise<PromotionValidationResult> {
    return this.promotions.validateForBasket(actor, input.code, input.subtotalKobo);
  }
}

@ApiTags('promotions')
@ApiBearerAuth('supabaseAuth')
@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('super_admin')
export class AdminPromotionsController {
  constructor(@Inject(PromotionsService) private readonly promotions: PromotionsService) {}

  @Post()
  @ApiOkResponse({ description: 'Created a promotion code.' })
  create(@Body() input: CreatePromotionDto): Promise<PromotionRecord> {
    return this.promotions.createPromotion(input);
  }

  @Get()
  @ApiOkResponse({ description: 'Listed all promotion codes.' })
  list(): Promise<PromotionRecord[]> {
    return this.promotions.listPromotions();
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  @ApiOkResponse({ description: 'Deactivated a promotion code.' })
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.promotions.deactivatePromotion(id);
  }
}
