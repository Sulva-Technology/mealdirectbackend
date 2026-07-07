import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  AdminMenuItemParamDto,
  AdminMenuVendorParamDto,
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  MenuCategoryEnvelopeDto,
  MenuMetadataEnvelopeDto,
  UpdateMenuItemDto,
  VendorMenuItemEnvelopeDto,
  VendorMenuItemListEnvelopeDto
} from './dto/vendor.dto.js';
import { VendorsService } from './vendors.service.js';
import type { MenuCategoryRecord, MenuItemRecord, MenuMetadata } from './vendors.types.js';

// Menu management for admins. Vendors edit their own menu via VendorsController;
// this surface lets platform admins do the same for any vendor by id, so writes
// are gated on the admin role rather than vendor membership.
@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@ApiParam({ format: 'uuid', name: 'vendorId', type: String })
@Controller('admin/vendors/:vendorId')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminVendorMenuController {
  constructor(@Inject(VendorsService) private readonly vendors: VendorsService) {}

  @Get('menu-metadata')
  @ApiOkResponse({
    description: 'Vendor menu categories and active unit types.',
    type: MenuMetadataEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Vendor was not found.' })
  async getMenuMetadata(
    @Param() params: AdminMenuVendorParamDto
  ): Promise<SuccessEnvelope<MenuMetadata>> {
    return createSuccessEnvelope(await this.vendors.adminGetMenuMetadata(params.vendorId));
  }

  @Post('menu-categories')
  @ApiCreatedResponse({
    description: 'Created (or updated on slug conflict) vendor menu category.',
    type: MenuCategoryEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid menu category input.' })
  @ApiNotFoundResponse({ description: 'Vendor was not found.' })
  @ApiBody({ type: CreateMenuCategoryDto })
  async createMenuCategory(
    @Param() params: AdminMenuVendorParamDto,
    @Body() input: CreateMenuCategoryDto
  ): Promise<SuccessEnvelope<MenuCategoryRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminCreateMenuCategory(params.vendorId, input)
    );
  }

  @Get('menu-items')
  @ApiOkResponse({
    description: 'Vendor menu items including inactive historical items.',
    type: VendorMenuItemListEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Vendor was not found.' })
  async listMenuItems(
    @Param() params: AdminMenuVendorParamDto
  ): Promise<ListEnvelope<MenuItemRecord>> {
    const items = await this.vendors.adminListMenuItems(params.vendorId);
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Post('menu-items')
  @ApiCreatedResponse({ description: 'Created vendor menu item.', type: VendorMenuItemEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid menu item input.' })
  @ApiNotFoundResponse({ description: 'Vendor was not found.' })
  @ApiBody({ type: CreateMenuItemDto })
  async createMenuItem(
    @Param() params: AdminMenuVendorParamDto,
    @Body() input: CreateMenuItemDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminCreateMenuItem(params.vendorId, input)
    );
  }

  @Get('menu-items/:itemId')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({ description: 'Vendor menu item detail.', type: VendorMenuItemEnvelopeDto })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  async getMenuItem(
    @Param() params: AdminMenuItemParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminGetMenuItem(params.vendorId, params.itemId)
    );
  }

  @Patch('menu-items/:itemId')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({ description: 'Updated vendor menu item.', type: VendorMenuItemEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid menu item input.' })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  @ApiBody({ type: UpdateMenuItemDto })
  async updateMenuItem(
    @Param() params: AdminMenuItemParamDto,
    @Body() input: UpdateMenuItemDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminUpdateMenuItem(params.vendorId, params.itemId, input)
    );
  }

  @Post('menu-items/:itemId/activate')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({ description: 'Activated a vendor menu item.', type: VendorMenuItemEnvelopeDto })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  async activateMenuItem(
    @Param() params: AdminMenuItemParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminSetMenuItemActive(params.vendorId, params.itemId, true)
    );
  }

  @Post('menu-items/:itemId/deactivate')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Deactivated a vendor menu item without deleting history.',
    type: VendorMenuItemEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  async deactivateMenuItem(
    @Param() params: AdminMenuItemParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.adminSetMenuItemActive(params.vendorId, params.itemId, false)
    );
  }
}
