import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { OrderDetail, OrderStatus, OrderSummary } from '../orders/orders.types.js';
import type { VendorOrderListQueryDto } from './dto/vendor-orders.dto.js';
import { VendorOrdersRepository } from './vendor-orders.repository.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

@Injectable()
export class VendorOrdersService {
  constructor(
    @Inject(VendorOrdersRepository) private readonly repository: VendorOrdersRepository
  ) {}

  async listOrders(
    actor: AuthenticatedActor,
    query: VendorOrderListQueryDto
  ): Promise<OrderSummary[]> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const filters: { status?: OrderStatus; date?: string } = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.date !== undefined) filters.date = query.date;

    return this.repository.listVendorOrders(vendorId, filters, {
      page: query.page ?? 1,
      limit: query.limit ?? 20
    });
  }

  async getOrder(actor: AuthenticatedActor, orderId: string): Promise<OrderDetail> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const order = await this.repository.findVendorOrderById(vendorId, orderId);
    if (order === undefined) {
      throw notFound('Order was not found.');
    }

    return order;
  }

  async acceptOrder(actor: AuthenticatedActor, orderId: string): Promise<OrderDetail> {
    return this.transitionOrder(actor, orderId, 'accepted');
  }

  async prepareOrder(actor: AuthenticatedActor, orderId: string): Promise<OrderDetail> {
    return this.transitionOrder(actor, orderId, 'preparing');
  }

  async readyOrder(actor: AuthenticatedActor, orderId: string): Promise<OrderDetail> {
    return this.transitionOrder(actor, orderId, 'ready');
  }

  private async transitionOrder(
    actor: AuthenticatedActor,
    orderId: string,
    toStatus: OrderStatus
  ): Promise<OrderDetail> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const order = await this.repository.findVendorOrderById(vendorId, orderId);
    if (order === undefined) {
      throw notFound('Order was not found.');
    }

    try {
      await this.repository.transitionOrderStatus(orderId, toStatus, actor.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order status transition failed.';
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message
      });
    }

    // Return the updated order detail
    const updatedOrder = await this.repository.findVendorOrderById(vendorId, orderId);
    if (updatedOrder === undefined) {
      throw notFound('Order was not found.');
    }
    return updatedOrder;
  }

  private assertAndGetVendorId(actor: AuthenticatedActor): string {
    if (actor.role !== 'vendor' || actor.vendorId === undefined || actor.vendorId.length === 0) {
      throw forbidden('Vendor access is required.');
    }
    return actor.vendorId;
  }

  private async assertVendorAccess(vendorId: string, userId: string): Promise<void> {
    const hasAccess = await this.repository.assertVendorAccess(vendorId, userId);
    if (!hasAccess) {
      throw forbidden('Vendor access is required.');
    }
  }
}
