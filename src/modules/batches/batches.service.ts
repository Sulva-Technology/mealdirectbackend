import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { BatchListQueryDto } from './dto/batches.dto.js';
import type { BatchDetail, BatchStatus, BatchSummary } from './batches.types.js';
import { BatchesRepository } from './batches.repository.js';

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
export class BatchesService {
  constructor(@Inject(BatchesRepository) private readonly repository: BatchesRepository) {}

  async listBatches(
    actor: AuthenticatedActor,
    query: BatchListQueryDto
  ): Promise<BatchSummary[]> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const filters: { status?: BatchStatus; date?: string } = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.date !== undefined) filters.date = query.date;

    return this.repository.listVendorBatches(vendorId, filters);
  }

  async getBatch(actor: AuthenticatedActor, batchId: string): Promise<BatchDetail> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const batch = await this.repository.findVendorBatchById(vendorId, batchId);
    if (batch === undefined) {
      throw notFound('Batch was not found.');
    }

    const orders = await this.repository.findBatchOrders(batchId);
    return {
      ...batch,
      orders
    };
  }

  async pickupBatch(actor: AuthenticatedActor, batchId: string): Promise<BatchDetail> {
    const vendorId = this.assertAndGetVendorId(actor);
    await this.assertVendorAccess(vendorId, actor.userId);

    const batch = await this.repository.findVendorBatchById(vendorId, batchId);
    if (batch === undefined) {
      throw notFound('Batch was not found.');
    }

    try {
      await this.repository.pickupBatch(batchId, actor.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ready-for-pickup transition failed.';
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message
      });
    }

    return this.getBatch(actor, batchId);
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
