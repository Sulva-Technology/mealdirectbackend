import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { DatabaseService } from '../../database/database.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';

type CreateOrderResult = {
  order_id: string;
};

function requestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

@Injectable()
export class OrdersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createOrder(
    actor: AuthenticatedActor,
    input: CreateOrderDto,
    idempotencyKey: string
  ): Promise<{ orderId: string }> {
    if (actor.role !== 'customer') {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Only customers can create orders.'
      });
    }

    const items = input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity
    }));

    const result = await sql<CreateOrderResult>`
      select public.create_pending_order_and_reserve_inventory(
        ${actor.userId}::uuid,
        ${input.campusId}::uuid,
        ${input.vendorId}::uuid,
        ${input.serviceDate}::date,
        ${input.deliverySlotId}::uuid,
        ${input.locationId}::uuid,
        ${input.deliveryMode ?? null}::public.delivery_mode,
        ${JSON.stringify(items)}::jsonb,
        ${idempotencyKey},
        ${requestHash(input)}
      ) as order_id
    `.execute(this.database.db);

    const orderId = result.rows[0]?.order_id;
    if (orderId === undefined) {
      throw new Error('Order creation did not return an order ID.');
    }

    return { orderId };
  }
}
