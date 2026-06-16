import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
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
  CampusEnvelopeDto,
  CampusIdParamDto,
  CampusListEnvelopeDto,
  CreateCampusDto,
  CreateDeliverySlotDto,
  CreateLocationDto,
  CreateZoneDto,
  DeliverySlotEnvelopeDto,
  DeliverySlotIdParamDto,
  DeliverySlotListEnvelopeDto,
  DeliverySlotsQueryDto,
  LocationEnvelopeDto,
  LocationIdParamDto,
  LocationListEnvelopeDto,
  UpdateCampusDto,
  UpdateDeliverySlotDto,
  UpdateLocationDto,
  UpdateZoneDto,
  ZoneEnvelopeDto,
  ZoneIdParamDto,
  ZoneListEnvelopeDto
} from './dto/campus-directory.dto.js';
import { CampusDirectoryService } from './campus-directory.service.js';
import type {
  CampusLocationRecord,
  CampusRecord,
  CampusZoneRecord,
  DeliverySlotRecord
} from './campus-directory.types.js';

function listEnvelope<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, {
    hasMore: false,
    limit: items.length
  });
}

@ApiTags('campuses')
@Controller('campuses')
export class PublicCampusDirectoryController {
  constructor(@Inject(CampusDirectoryService) private readonly campuses: CampusDirectoryService) {}

  @Get()
  @ApiOkResponse({
    description: 'Active campuses available to public clients.',
    type: CampusListEnvelopeDto
  })
  async listCampuses(): Promise<ListEnvelope<CampusRecord>> {
    return listEnvelope(await this.campuses.listPublicCampuses());
  }

  @Get(':campusId/locations')
  @ApiOkResponse({
    description: 'Active preset delivery locations for a campus.',
    type: LocationListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid campus ID.' })
  async listLocations(
    @Param() params: CampusIdParamDto
  ): Promise<ListEnvelope<CampusLocationRecord>> {
    return listEnvelope(await this.campuses.listPublicLocations(params.campusId));
  }

  @Get(':campusId/delivery-slots')
  @ApiOkResponse({
    description: 'Active delivery slots for a campus, optionally with date cutoffs.',
    type: DeliverySlotListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid campus ID or date filter.' })
  async listDeliverySlots(
    @Param() params: CampusIdParamDto,
    @Query() query: DeliverySlotsQueryDto
  ): Promise<ListEnvelope<DeliverySlotRecord>> {
    return listEnvelope(await this.campuses.listPublicDeliverySlots(params.campusId, query.date));
  }
}

@ApiTags('admin-campuses')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminCampusDirectoryController {
  constructor(@Inject(CampusDirectoryService) private readonly campuses: CampusDirectoryService) {}

  @Get('campuses')
  @ApiOkResponse({ description: 'Admin-visible campuses.', type: CampusListEnvelopeDto })
  async listCampuses(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<CampusRecord>> {
    return listEnvelope(await this.campuses.listAdminCampuses(actor));
  }

  @Post('campuses')
  @HttpCode(201)
  @ApiOkResponse({ description: 'Created campus.', type: CampusEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid campus input.' })
  async createCampus(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: CreateCampusDto
  ): Promise<SuccessEnvelope<CampusRecord>> {
    return createSuccessEnvelope(await this.campuses.createCampus(actor, input));
  }

  @Patch('campuses/:campusId')
  @ApiOkResponse({ description: 'Updated campus.', type: CampusEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid campus input.' })
  async updateCampus(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto,
    @Body() input: UpdateCampusDto
  ): Promise<SuccessEnvelope<CampusRecord>> {
    return createSuccessEnvelope(await this.campuses.updateCampus(actor, params.campusId, input));
  }

  @Get('campuses/:campusId/zones')
  @ApiOkResponse({ description: 'Campus zones for admins.', type: ZoneListEnvelopeDto })
  async listZones(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto
  ): Promise<ListEnvelope<CampusZoneRecord>> {
    return listEnvelope(await this.campuses.listAdminZones(actor, params.campusId));
  }

  @Post('campuses/:campusId/zones')
  @HttpCode(201)
  @ApiOkResponse({ description: 'Created campus zone.', type: ZoneEnvelopeDto })
  async createZone(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto,
    @Body() input: CreateZoneDto
  ): Promise<SuccessEnvelope<CampusZoneRecord>> {
    return createSuccessEnvelope(await this.campuses.createZone(actor, params.campusId, input));
  }

  @Patch('zones/:zoneId')
  @ApiOkResponse({ description: 'Updated campus zone.', type: ZoneEnvelopeDto })
  async updateZone(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ZoneIdParamDto,
    @Body() input: UpdateZoneDto
  ): Promise<SuccessEnvelope<CampusZoneRecord>> {
    return createSuccessEnvelope(await this.campuses.updateZone(actor, params.zoneId, input));
  }

  @Get('campuses/:campusId/locations')
  @ApiOkResponse({ description: 'Campus locations for admins.', type: LocationListEnvelopeDto })
  async listLocations(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto
  ): Promise<ListEnvelope<CampusLocationRecord>> {
    return listEnvelope(await this.campuses.listAdminLocations(actor, params.campusId));
  }

  @Post('campuses/:campusId/locations')
  @HttpCode(201)
  @ApiOkResponse({ description: 'Created campus location.', type: LocationEnvelopeDto })
  async createLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto,
    @Body() input: CreateLocationDto
  ): Promise<SuccessEnvelope<CampusLocationRecord>> {
    return createSuccessEnvelope(
      await this.campuses.createLocation(actor, params.campusId, {
        active: input.active,
        deliveryInstructions: input.deliveryInstructions ?? null,
        displayOrder: input.displayOrder,
        name: input.name,
        slug: input.slug,
        type: input.type,
        zoneId: input.zoneId
      })
    );
  }

  @Patch('locations/:locationId')
  @ApiOkResponse({ description: 'Updated campus location.', type: LocationEnvelopeDto })
  async updateLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: LocationIdParamDto,
    @Body() input: UpdateLocationDto
  ): Promise<SuccessEnvelope<CampusLocationRecord>> {
    return createSuccessEnvelope(
      await this.campuses.updateLocation(actor, params.locationId, input)
    );
  }

  @Get('campuses/:campusId/delivery-slots')
  @ApiOkResponse({
    description: 'Campus delivery slots for admins.',
    type: DeliverySlotListEnvelopeDto
  })
  async listDeliverySlots(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto
  ): Promise<ListEnvelope<DeliverySlotRecord>> {
    return listEnvelope(await this.campuses.listAdminDeliverySlots(actor, params.campusId));
  }

  @Post('campuses/:campusId/delivery-slots')
  @HttpCode(201)
  @ApiOkResponse({ description: 'Created campus delivery slot.', type: DeliverySlotEnvelopeDto })
  async createDeliverySlot(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: CampusIdParamDto,
    @Body() input: CreateDeliverySlotDto
  ): Promise<SuccessEnvelope<DeliverySlotRecord>> {
    return createSuccessEnvelope(
      await this.campuses.createDeliverySlot(actor, params.campusId, input)
    );
  }

  @Patch('delivery-slots/:slotId')
  @ApiOkResponse({ description: 'Updated campus delivery slot.', type: DeliverySlotEnvelopeDto })
  async updateDeliverySlot(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: DeliverySlotIdParamDto,
    @Body() input: UpdateDeliverySlotDto
  ): Promise<SuccessEnvelope<DeliverySlotRecord>> {
    return createSuccessEnvelope(
      await this.campuses.updateDeliverySlot(actor, params.slotId, input)
    );
  }
}
