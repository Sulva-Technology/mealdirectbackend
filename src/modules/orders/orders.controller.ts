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
import { normalizeIdempotencyKey } from '../../common/http/idempotency-key.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrdersService } from './orders.service.js';

function requireIdempotencyKey(value: string | string[] | undefined): string {
  try {
    return normalizeIdempotencyKey(value);
  } catch (error) {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_FAILED,
      message:
        error instanceof Error ? error.message : 'Idempotency-Key header is invalid.'
    });
  }
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
    return this.orders.createOrder(actor, input, requireIdempotencyKey(idempotencyKey));
  }
}
