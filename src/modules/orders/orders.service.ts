import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { calculateOrderPricing } from '../../domain/pricing.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PaymentsService } from '../payments/payments.service.js';
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
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(PaymentsService) private readonly payments: PaymentsService
  ) {}

  async quoteOrder(actor: AuthenticatedActor, input: CreateOrderDto): Promise<OrderQuote> {
    customerOnly(actor);
    return (await this.buildQuote(input)).quote;
  }

  async createOrder(
    actor: AuthenticatedActor,
    input: CreateOrderDto,
    idempotencyKey: string
  ): Promise<{ orderId: string }> {
    customerOnly(actor);
    const { quote, serviceFeeKobo } = await this.buildQuote(input);
    const maxOrderTotalKobo = this.env.get('MAX_ORDER_TOTAL_KOBO');
    const accepted = input.acceptLargeOrderSurcharge === true;

    // The quoted total already includes delivery + service fees (and the large-order surcharge)
    // but not promo discounts (applied inside the RPC). With no promo code the quote IS the final
    // total, so we can reject an un-accepted over-cap order before any charge. When a promo code
    // is present the RPC is the authoritative gate (it knows the discount) so we defer to it.
    if (input.promotionCode === undefined && quote.exceedsStandardCap && !accepted) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message:
          'Order total exceeds the standard ₦2490 cap. Set acceptLargeOrderSurcharge to accept the 1.5% + ₦100 surcharge.'
      });
    }

    return this.repository.createOrder(
      actor.userId,
      input,
      idempotencyKey,
      hashOrderRequest(input),
      serviceFeeKobo,
      maxOrderTotalKobo,
      {
        surchargeBps: this.env.get('LARGE_ORDER_SURCHARGE_BPS'),
        surchargeFlatKobo: this.env.get('LARGE_ORDER_SURCHARGE_FLAT_KOBO'),
        accepted
      }
    );
  }

  private async buildQuote(
    input: CreateOrderDto
  ): Promise<{ quote: OrderQuote; serviceFeeKobo: number }> {
    const quotedItems = await this.repository.quoteOrder(input);
    this.assertAllItemsQuoted(input, quotedItems);

    const zoneFeeKobo = await this.repository.findZoneDeliveryFeeKobo(input.locationId);
    const serviceFeeKobo = quotedItems.some((item) => item.countsTowardSpoonLimit)
      ? await this.resolveServiceFeeKobo(input.vendorId)
      : 0;

    const pricing = calculateOrderPricing({
      lines: quotedItems.map((item) => ({
        unitPriceCents: item.unitPriceKobo,
        quantity: item.quantity
      })),
      deliveryFeeCents: zoneFeeKobo ?? this.env.get('DELIVERY_FEE_KOBO'),
      serviceFeeCents: serviceFeeKobo,
      largeOrderThresholdCents: this.env.get('MAX_ORDER_TOTAL_KOBO'),
      largeOrderSurchargeBps: this.env.get('LARGE_ORDER_SURCHARGE_BPS'),
      largeOrderSurchargeFlatCents: this.env.get('LARGE_ORDER_SURCHARGE_FLAT_KOBO')
    });

    return {
      quote: {
        currency: 'NGN',
        deliveryFeeKobo: pricing.deliveryFeeCents,
        serviceFeeKobo: pricing.serviceFeeCents,
        discountKobo: pricing.discountCents,
        foodSubtotalKobo: pricing.subtotalCents,
        largeOrderSurchargeKobo: pricing.largeOrderSurchargeCents,
        exceedsStandardCap: pricing.exceedsLargeOrderThreshold,
        items: quotedItems,
        totalKobo: pricing.totalCents
      },
      serviceFeeKobo
    };
  }

  // Effective takeaway/packaging fee: the vendor's own value when set, otherwise the global
  // default, clamped to the vendor campus ceiling as a safety net against stale overrides.
  private async resolveServiceFeeKobo(vendorId: string): Promise<number> {
    const globalDefault = this.env.get('SERVICE_FEE_KOBO');
    const config = await this.repository.findVendorServiceFeeConfig(vendorId);
    if (config === undefined) {
      return globalDefault;
    }
    const base = config.serviceFeeKobo ?? globalDefault;
    return Math.min(base, config.maxServiceFeeKobo);
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
    // Webhook is production truth; this active verify is the fallback so polling still
    // resolves when no public webhook reached us (local/test, or a missed delivery).
    await this.payments.verifyPendingOrderPayment(actor.userId, orderId);
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
