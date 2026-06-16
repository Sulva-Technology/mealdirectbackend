import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createSuccessEnvelope } from '../../common/api/response.js';
import { createListEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { OrderIdParamDto } from '../orders/dto/order-api.dto.js';
import {
  CreateReviewDto,
  ReviewEnvelopeDto,
  VendorReviewListEnvelopeDto,
  VendorReviewListQueryDto
} from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';
import type { ReviewRecord, VendorReviewRecord } from './reviews.types.js';

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

@ApiTags('vendor-reviews')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('vendor/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Cursor-paginated customer reviews for the authenticated vendor.',
    type: VendorReviewListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid review filters or cursor.' })
  async listReviews(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: VendorReviewListQueryDto
  ): Promise<ListEnvelope<VendorReviewRecord>> {
    const page = await this.reviews.listVendorReviews(actor, query);
    return createListEnvelope(page.items, page.pagination);
  }
}
