import { Body, Controller, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
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
  CreateInventoryAdjustmentDto,
  InventoryAdjustmentEnvelopeDto,
  InventoryIdParamDto,
  UpdateInventoryDto,
  VendorInventoryEnvelopeDto,
  VendorInventoryListEnvelopeDto,
  VendorInventoryQueryDto
} from './dto/inventory.dto.js';
import { InventoryService } from './inventory.service.js';
import type { InventoryAdjustmentResponse, InventoryRecord } from './inventory.types.js';

function listEnvelope<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, {
    hasMore: false,
    limit: items.length
  });
}

@ApiTags('vendor-inventory')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor role and vendor membership are required.' })
@Controller('vendor/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get()
  @ApiOkResponse({
    description: 'Vendor-owned dated inventory for a service date and optional delivery slot.',
    type: VendorInventoryListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid inventory filters.' })
  async listInventory(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: VendorInventoryQueryDto
  ): Promise<ListEnvelope<InventoryRecord>> {
    const rows = await this.inventory.listInventory(actor, query);
    return listEnvelope(rows);
  }

  @Put(':inventoryId')
  @ApiParam({ format: 'uuid', name: 'inventoryId', type: String })
  @ApiBody({ type: UpdateInventoryDto })
  @ApiOkResponse({
    description: 'Updates the editable starting quantity for a vendor-owned inventory row.',
    type: VendorInventoryEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid inventory quantity or stale state.' })
  @ApiNotFoundResponse({ description: 'Inventory row was not found for this vendor.' })
  async updateInventory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: InventoryIdParamDto,
    @Body() input: UpdateInventoryDto
  ): Promise<SuccessEnvelope<InventoryRecord>> {
    return createSuccessEnvelope(
      await this.inventory.updateInventory(actor, params.inventoryId, input)
    );
  }

  @Post(':inventoryId/adjustments')
  @ApiParam({ format: 'uuid', name: 'inventoryId', type: String })
  @ApiBody({ type: CreateInventoryAdjustmentDto })
  @ApiCreatedResponse({
    description: 'Records an append-only vendor inventory adjustment.',
    type: InventoryAdjustmentEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid inventory adjustment.' })
  @ApiNotFoundResponse({ description: 'Inventory row was not found for this vendor.' })
  async createAdjustment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: InventoryIdParamDto,
    @Body() input: CreateInventoryAdjustmentDto
  ): Promise<SuccessEnvelope<InventoryAdjustmentResponse>> {
    return createSuccessEnvelope(
      await this.inventory.createAdjustment(actor, params.inventoryId, input)
    );
  }
}
