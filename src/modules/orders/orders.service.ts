import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { calculateOrderPricing } from '../../domain/pricing.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import { hashOrderRequest, OrdersRepository } from './orders.repository.js';
import type {
  OrderDetail,
  OrderListFilters,
  OrderPaymentStatus,
  OrderQuote,
  OrderQuoteItem,
  OrdersRepositoryContract,
  OrderSummary
} from './orders.types.js';

function customerOnly(actor: AuthenticatedActor): void {
  if (actor.role !== 'customer') {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_FAILED,
      message: 'Only customers can use customer order endpoints.'
    });
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(OrdersRepository) private readonly repository: OrdersRepositoryContract,
    @Inject(EnvService) private readonly env: EnvService
  ) {}

  async quoteOrder(actor: AuthenticatedActor, input: CreateOrderDto): Promise<OrderQuote> {
    customerOnly(actor);
    const quotedItems = await this.repository.quoteOrder(input);
    this.assertAllItemsQuoted(input, quotedItems);

    const pricing = calculateOrderPricing({
      lines: quotedItems.map((item) => ({
        unitPriceCents: item.unitPriceKobo,
        quantity: item.quantity
      })),
      deliveryFeeCents: this.env.get('DELIVERY_FEE_KOBO'),
      serviceFeeCents: this.env.get('SERVICE_FEE_KOBO')
    });

    return {
      currency: 'NGN',
      deliveryFeeKobo: pricing.deliveryFeeCents,
      serviceFeeKobo: pricing.serviceFeeCents,
      discountKobo: pricing.discountCents,
      foodSubtotalKobo: pricing.subtotalCents,
      items: quotedItems,
      totalKobo: pricing.totalCents
    };
  }

  async createOrder(
    actor: AuthenticatedActor,
    input: CreateOrderDto,
    idempotencyKey: string
  ): Promise<{ orderId: string }> {
    customerOnly(actor);
    return this.repository.createOrder(
      actor.userId,
      input,
      idempotencyKey,
      hashOrderRequest(input)
    );
  }

  async listCustomerOrders(
    actor: AuthenticatedActor,
    filters: OrderListFilters
  ): Promise<OrderSummary[]> {
    customerOnly(actor);
    return this.repository.listCustomerOrders(actor.userId, filters);
  }

  async getCustomerOrder(actor: AuthenticatedActor, orderId: string): Promise<OrderDetail> {
    customerOnly(actor);
    const order = await this.repository.findCustomerOrderById(actor.userId, orderId);
    if (order === undefined) {
      throw notFound('Order was not found.');
    }
    return order;
  }

  async getPaymentStatus(actor: AuthenticatedActor, orderId: string): Promise<OrderPaymentStatus> {
    customerOnly(actor);
    const status = await this.repository.findPaymentStatus(actor.userId, orderId);
    if (status === undefined) {
      throw notFound('Order was not found.');
    }
    return status;
  }

  async confirmDelivery(
    actor: AuthenticatedActor,
    orderId: string
  ): Promise<{ confirmationId: string }> {
    customerOnly(actor);
    return this.repository.confirmDelivery(actor.userId, orderId);
  }

  private assertAllItemsQuoted(
    input: CreateOrderDto,
    quotedItems: readonly OrderQuoteItem[]
  ): void {
    const quotedByMenuItemId = new Map(quotedItems.map((item) => [item.menuItemId, item]));
    const unavailableItem = input.items.find((item) => {
      const quoted = quotedByMenuItemId.get(item.menuItemId);
      return quoted?.quantity !== item.quantity;
    });

    if (unavailableItem !== undefined) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'One or more order items are unavailable for the requested date and slot.'
      });
    }
  }
}
