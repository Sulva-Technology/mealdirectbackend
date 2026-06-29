import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { normalizeIdempotencyKey } from '../../common/http/idempotency-key.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import {
  DeliveryConfirmationEnvelopeDto,
  OrderDetailEnvelopeDto,
  OrderIdParamDto,
  OrderListEnvelopeDto,
  OrderListQueryDto,
  OrderPaymentStatusEnvelopeDto,
  OrderQuoteEnvelopeDto
} from './dto/order-api.dto.js';
import { OrdersService } from './orders.service.js';
import type { OrderDetail, OrderPaymentStatus, OrderQuote, OrderSummary } from './orders.types.js';

function requireIdempotencyKey(value: string | string[] | undefined): string {
  try {
    return normalizeIdempotencyKey(value);
  } catch (error) {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_FAILED,
      message: error instanceof Error ? error.message : 'Idempotency-Key header is invalid.'
    });
  }
}

@ApiTags('orders')
@ApiBearerAuth('supabaseAuth')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post('quote')
  @HttpCode(200)
  @RequireRoles('customer')
  @ApiBody({ type: CreateOrderDto })
  @ApiOkResponse({
    description: 'Order quote using current menu and slot availability.',
    type: OrderQuoteEnvelopeDto
  })
  async quoteOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: CreateOrderDto
  ): Promise<SuccessEnvelope<OrderQuote>> {
    return createSuccessEnvelope(await this.orders.quoteOrder(actor, input));
  }

  @Get()
  @RequireRoles('customer')
  @ApiOkResponse({ description: 'Customer order history.', type: OrderListEnvelopeDto })
  async listOrders(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: OrderListQueryDto
  ): Promise<ListEnvelope<OrderSummary>> {
    const orders = await this.orders.listCustomerOrders(actor, query);
    return createListEnvelope(orders, { hasMore: false, limit: orders.length });
  }

  @Post()
  @HttpCode(201)
  @RequireRoles('customer')
  @ApiBody({ type: CreateOrderDto })
  @ApiCreatedResponse({ description: 'Order was created idempotently and inventory was reserved.' })
  async createOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Body() input: CreateOrderDto
  ): Promise<{ orderId: string }> {
    return this.orders.createOrder(actor, input, requireIdempotencyKey(idempotencyKey));
  }

  @Get(':orderId/payment-status')
  @RequireRoles('customer')
  @ApiOkResponse({
    description: 'Customer-visible payment status for an order.',
    type: OrderPaymentStatusEnvelopeDto
  })
  async paymentStatus(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto
  ): Promise<SuccessEnvelope<OrderPaymentStatus>> {
    return createSuccessEnvelope(await this.orders.getPaymentStatus(actor, params.orderId));
  }

  @Post(':orderId/confirm-delivery')
  @RequireRoles('customer')
  @ApiOkResponse({
    description: 'Customer delivery confirmation.',
    type: DeliveryConfirmationEnvelopeDto
  })
  async confirmDelivery(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto
  ): Promise<SuccessEnvelope<{ confirmationId: string }>> {
    return createSuccessEnvelope(await this.orders.confirmDelivery(actor, params.orderId));
  }

  @Get(':orderId')
  @RequireRoles('customer')
  @ApiOkResponse({ description: 'Customer-owned order detail.', type: OrderDetailEnvelopeDto })
  async getOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto
  ): Promise<SuccessEnvelope<OrderDetail>> {
    return createSuccessEnvelope(await this.orders.getCustomerOrder(actor, params.orderId));
  }
}
