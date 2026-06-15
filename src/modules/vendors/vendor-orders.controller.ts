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
  VendorOrderDetailEnvelopeDto,
  VendorOrderIdParamDto,
  VendorOrderListEnvelopeDto,
  VendorOrderListQueryDto
} from './dto/vendor-orders.dto.js';
import { VendorOrdersService } from './vendor-orders.service.js';
import type { OrderDetail, OrderSummary } from '../orders/orders.types.js';

@ApiTags('vendor-orders')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor role and vendor membership are required.' })
@Controller('vendor/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorOrdersController {
  constructor(@Inject(VendorOrdersService) private readonly ordersService: VendorOrdersService) {}

  @Get()
  @ApiOkResponse({
    description: 'List of orders placed with the authenticated vendor.',
    type: VendorOrderListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid query filters.' })
  async listOrders(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: VendorOrderListQueryDto
  ): Promise<ListEnvelope<OrderSummary>> {
    const orders = await this.ordersService.listOrders(actor, query);
    return createListEnvelope(orders, {
      hasMore: false,
      limit: query.limit ?? 20
    });
  }

  @Get(':orderId')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Detailed summary of a single vendor order, including items.',
    type: VendorOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  async getOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.ordersService.getOrder(actor, params.orderId));
  }

  @Post(':orderId/accept')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Order accepted by the vendor.',
    type: VendorOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid order transition.' })
  async acceptOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.ordersService.acceptOrder(actor, params.orderId));
  }

  @Post(':orderId/prepare')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Order preparation started by the vendor.',
    type: VendorOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid order transition.' })
  async prepareOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.ordersService.prepareOrder(actor, params.orderId));
  }

  @Post(':orderId/preparing')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Order preparation started by the vendor.',
    type: VendorOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid order transition.' })
  async preparingOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.ordersService.prepareOrder(actor, params.orderId));
  }

  @Post(':orderId/ready')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Order marked ready for pickup by the vendor.',
    type: VendorOrderDetailEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  @ApiBadRequestResponse({ description: 'Invalid order transition.' })
  async readyOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: VendorOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.ordersService.readyOrder(actor, params.orderId));
  }
}
