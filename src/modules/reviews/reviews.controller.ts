import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createSuccessEnvelope } from '../../common/api/response.js';
import type { SuccessEnvelope } from '../../common/api/response.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { OrderIdParamDto } from '../orders/dto/order-api.dto.js';
import { CreateReviewDto, ReviewEnvelopeDto } from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';
import type { ReviewRecord } from './reviews.types.js';

@ApiTags('reviews')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('customer')
export class CustomerReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Post(':orderId/review')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiCreatedResponse({
    description: 'Created or existing customer review for an owned confirmed order.',
    type: ReviewEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid review input or ineligible order.' })
  async createReview(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto,
    @Body() input: CreateReviewDto
  ): Promise<SuccessEnvelope<ReviewRecord>> {
    return createSuccessEnvelope(await this.reviews.createReview(actor, params.orderId, input));
  }
}
