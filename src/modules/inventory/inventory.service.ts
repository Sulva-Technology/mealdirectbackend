import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { InventoryRepository } from './inventory.repository.js';
import type {
  CreateInventoryAdjustmentInput,
  InventoryAdjustmentResponse,
  InventoryListFilters,
  InventoryRecord,
  InventoryRepositoryContract,
  UpdateInventoryInput
} from './inventory.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function conflict(message: string): ConflictException {
  return new ConflictException({
    code: ErrorCodes.CONFLICT,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

function committedQuantity(inventory: InventoryRecord): number {
  return inventory.quantityReserved + inventory.quantitySold;
}

function assertEffectiveQuantityCanCoverCommitted(
  effectiveQuantity: number,
  inventory: InventoryRecord
): void {
  if (effectiveQuantity < committedQuantity(inventory)) {
    throw badRequest('Effective inventory cannot be lower than reserved plus sold quantity.');
  }
}

@Injectable()
export class InventoryService {
  constructor(
    @Inject(InventoryRepository) private readonly repository: InventoryRepositoryContract
  ) {}

  async listInventory(
    actor: AuthenticatedActor,
    filters: InventoryListFilters
  ): Promise<InventoryRecord[]> {
    const vendorId = await this.assertActorCanUseVendor(actor);
    return this.repository.listInventory(vendorId, filters);
  }

  async updateInventory(
    actor: AuthenticatedActor,
    inventoryId: string,
    input: UpdateInventoryInput
  ): Promise<InventoryRecord> {
    const vendorId = await this.assertActorCanUseVendor(actor);
    const inventory = await this.repository.findInventoryForVendor(vendorId, inventoryId);
    if (inventory === undefined) {
      throw notFound('Inventory row was not found.');
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== inventory.version) {
      throw conflict('Inventory was modified by another operation.');
    }

    assertEffectiveQuantityCanCoverCommitted(
      input.quantityTotal + inventory.quantityAdjusted,
      inventory
    );

    const updated = await this.repository.updateInventoryTotal(vendorId, inventoryId, input);
    if (updated === undefined) {
      throw notFound('Inventory row was not found.');
    }

    return updated;
  }

  async createAdjustment(
    actor: AuthenticatedActor,
    inventoryId: string,
    input: CreateInventoryAdjustmentInput
  ): Promise<InventoryAdjustmentResponse> {
    const vendorId = await this.assertActorCanUseVendor(actor);
    const inventory = await this.repository.findInventoryForVendor(vendorId, inventoryId);
    if (inventory === undefined) {
      throw notFound('Inventory row was not found.');
    }

    assertEffectiveQuantityCanCoverCommitted(
      inventory.quantityTotal + inventory.quantityAdjusted + input.adjustmentQuantity,
      inventory
    );

    return this.repository.recordAdjustment(
      vendorId,
      inventoryId,
      {
        adjustmentQuantity: input.adjustmentQuantity,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        reason: input.reason.trim()
      },
      actor.userId
    );
  }

  private async assertActorCanUseVendor(actor: AuthenticatedActor): Promise<string> {
    const vendorId = actor.vendorId;
    if (actor.role !== 'vendor' || vendorId === undefined) {
      throw forbidden('Vendor access is required.');
    }

    if (!(await this.repository.assertVendorAccess(vendorId, actor.userId))) {
      throw forbidden('Vendor access is required.');
    }

    return vendorId;
  }
}
