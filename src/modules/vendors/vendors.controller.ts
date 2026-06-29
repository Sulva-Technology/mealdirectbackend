import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
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
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  AvailabilityListEnvelopeDto,
  AvailabilityUpdateDto,
  CreateMenuItemDto,
  MenuItemIdParamDto,
  MenuMetadataEnvelopeDto,
  OnboardVendorDto,
  UpdateMenuItemDto,
  UpdateVendorProfileDto,
  UpsertPayoutAccountDto,
  VendorMenuItemEnvelopeDto,
  VendorMenuItemListEnvelopeDto,
  VendorOnboardEnvelopeDto,
  VendorPayoutAccountEnvelopeDto,
  VendorProfileEnvelopeDto
} from './dto/vendor.dto.js';
import type { VendorOnboardResult } from './vendors.service.js';
import { VendorsService } from './vendors.service.js';
import type {
  MenuItemAvailabilityEntry,
  MenuItemRecord,
  MenuMetadata,
  VendorAvailabilityEntry,
  VendorPayoutAccount,
  VendorProfile
} from './vendors.types.js';

function listEnvelope<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, {
    hasMore: false,
    limit: items.length
  });
}

function vendorIdFromActor(actor: AuthenticatedActor): string {
  return actor.vendorId ?? '';
}

@ApiTags('vendor')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Vendor role and vendor membership are required.' })
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorsController {
  constructor(@Inject(VendorsService) private readonly vendors: VendorsService) {}

  @Post('onboard')
  @ApiCreatedResponse({
    description:
      'Provisions the vendor record and links the caller as owner. The client must refresh its session afterwards to receive the vendor_id claim.',
    type: VendorOnboardEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid onboarding input or unknown campus.' })
  @ApiBody({ type: OnboardVendorDto })
  async onboard(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: OnboardVendorDto
  ): Promise<SuccessEnvelope<VendorOnboardResult>> {
    return createSuccessEnvelope(await this.vendors.onboardVendor(actor, input));
  }

  @Get('profile')
  @ApiOkResponse({
    description: 'Current vendor profile and approval state.',
    type: VendorProfileEnvelopeDto
  })
  async getProfile(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<VendorProfile>> {
    return createSuccessEnvelope(await this.vendors.getProfile(actor, vendorIdFromActor(actor)));
  }

  @Patch('profile')
  @ApiOkResponse({
    description: 'Updated safe vendor profile fields.',
    type: VendorProfileEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid vendor profile input.' })
  @ApiBody({ type: UpdateVendorProfileDto })
  async updateProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpdateVendorProfileDto
  ): Promise<SuccessEnvelope<VendorProfile>> {
    return createSuccessEnvelope(
      await this.vendors.updateProfile(actor, vendorIdFromActor(actor), input)
    );
  }

  @Get('payout-account')
  @ApiOkResponse({
    description: 'Current masked payout account snapshot, if configured.',
    type: VendorPayoutAccountEnvelopeDto
  })
  async getPayoutAccount(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<VendorPayoutAccount | null>> {
    return createSuccessEnvelope(
      await this.vendors.getPayoutAccount(actor, vendorIdFromActor(actor))
    );
  }

  @Put('payout-account')
  @ApiOkResponse({
    description: 'Replaces the active payout account with a masked snapshot.',
    type: VendorPayoutAccountEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid payout account input.' })
  @ApiBody({ type: UpsertPayoutAccountDto })
  async updatePayoutAccount(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpsertPayoutAccountDto
  ): Promise<SuccessEnvelope<VendorPayoutAccount>> {
    return createSuccessEnvelope(
      await this.vendors.upsertPayoutAccount(actor, vendorIdFromActor(actor), input)
    );
  }

  @Get('menu-metadata')
  @ApiOkResponse({
    description: 'Vendor menu categories and active unit types.',
    type: MenuMetadataEnvelopeDto
  })
  async getMenuMetadata(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<MenuMetadata>> {
    return createSuccessEnvelope(
      await this.vendors.getMenuMetadata(actor, vendorIdFromActor(actor))
    );
  }

  @Get('menu-items')
  @ApiOkResponse({
    description: 'Vendor-owned menu items including inactive historical items.',
    type: VendorMenuItemListEnvelopeDto
  })
  async listMenuItems(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<MenuItemRecord>> {
    const items = await this.vendors.listMenuItems(actor, vendorIdFromActor(actor));
    return listEnvelope(items);
  }

  @Post('menu-items')
  @ApiCreatedResponse({
    description: 'Created vendor-owned menu item.',
    type: VendorMenuItemEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid menu item input.' })
  @ApiBody({ type: CreateMenuItemDto })
  async createMenuItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: CreateMenuItemDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.createMenuItem(actor, vendorIdFromActor(actor), input)
    );
  }

  @Get('menu-items/:itemId')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Vendor-owned menu item detail.',
    type: VendorMenuItemEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  async getMenuItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.getMenuItem(actor, vendorIdFromActor(actor), params.itemId)
    );
  }

  @Patch('menu-items/:itemId')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Updated vendor-owned menu item safe fields.',
    type: VendorMenuItemEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid menu item input.' })
  @ApiNotFoundResponse({ description: 'Menu item was not found for this vendor.' })
  @ApiBody({ type: UpdateMenuItemDto })
  async updateMenuItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto,
    @Body() input: UpdateMenuItemDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.updateMenuItem(actor, vendorIdFromActor(actor), params.itemId, input)
    );
  }

  @Post('menu-items/:itemId/activate')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Activated a vendor-owned menu item.',
    type: VendorMenuItemEnvelopeDto
  })
  async activateMenuItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.activateMenuItem(actor, vendorIdFromActor(actor), params.itemId)
    );
  }

  @Post('menu-items/:itemId/deactivate')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Deactivated a vendor-owned menu item without deleting history.',
    type: VendorMenuItemEnvelopeDto
  })
  async deactivateMenuItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto
  ): Promise<SuccessEnvelope<MenuItemRecord>> {
    return createSuccessEnvelope(
      await this.vendors.deactivateMenuItem(actor, vendorIdFromActor(actor), params.itemId)
    );
  }

  @Get('menu-items/:itemId/schedules')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Current slot availability for a vendor-owned menu item.',
    type: AvailabilityListEnvelopeDto
  })
  async listMenuItemSchedules(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto
  ): Promise<ListEnvelope<MenuItemAvailabilityEntry>> {
    const schedules = await this.vendors.listMenuItemSchedules(
      actor,
      vendorIdFromActor(actor),
      params.itemId
    );
    return listEnvelope(schedules);
  }

  @Put('menu-items/:itemId/schedules')
  @ApiParam({ format: 'uuid', name: 'itemId', type: String })
  @ApiOkResponse({
    description: 'Replaced slot availability for a vendor-owned menu item.',
    type: AvailabilityListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid menu item schedule input.' })
  @ApiBody({ type: AvailabilityUpdateDto })
  async replaceMenuItemSchedules(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MenuItemIdParamDto,
    @Body() input: AvailabilityUpdateDto
  ): Promise<ListEnvelope<MenuItemAvailabilityEntry>> {
    const schedules = await this.vendors.replaceMenuItemSchedules(
      actor,
      vendorIdFromActor(actor),
      params.itemId,
      input
    );
    return listEnvelope(schedules);
  }

  @Get('availability')
  @ApiOkResponse({
    description: 'Vendor operating availability by delivery slot and day of week.',
    type: AvailabilityListEnvelopeDto
  })
  async listVendorAvailability(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<VendorAvailabilityEntry>> {
    const availability = await this.vendors.listVendorAvailability(actor, vendorIdFromActor(actor));
    return listEnvelope(availability);
  }

  @Put('availability')
  @ApiOkResponse({
    description: 'Replaced vendor operating availability by slot and day.',
    type: AvailabilityListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid vendor availability input.' })
  @ApiBody({ type: AvailabilityUpdateDto })
  async replaceVendorAvailability(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: AvailabilityUpdateDto
  ): Promise<ListEnvelope<VendorAvailabilityEntry>> {
    const availability = await this.vendors.replaceVendorAvailability(
      actor,
      vendorIdFromActor(actor),
      input
    );
    return listEnvelope(availability);
  }
}
