import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrdersService } from './orders.service.js';

function normalizeIdempotencyKey(value: string | string[] | undefined): string {
  const key = Array.isArray(value) ? value[0] : value;
  if (key === undefined || key.trim().length === 0) {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_FAILED,
      message: 'Idempotency-Key header is required.'
    });
  }
  return key;
}

@ApiTags('orders')
@ApiBearerAuth('supabaseAuth')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  @RequireRoles('customer')
  @ApiCreatedResponse({ description: 'Order was created idempotently and inventory was reserved.' })
  async createOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Body() input: CreateOrderDto
  ): Promise<{ orderId: string }> {
    return this.orders.createOrder(actor, input, normalizeIdempotencyKey(idempotencyKey));
  }
}
