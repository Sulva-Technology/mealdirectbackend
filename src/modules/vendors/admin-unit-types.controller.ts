import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
  CreateUnitTypeDto,
  UnitTypeEnvelopeDto,
  UnitTypeIdParamDto,
  UnitTypeListEnvelopeDto,
  UpdateUnitTypeDto
} from './dto/vendor.dto.js';
import { VendorsService } from './vendors.service.js';
import type { UnitTypeRecord } from './vendors.types.js';

// Unit types are a global catalogue shared by every vendor, so writes are gated
// on the platform admin role rather than vendor membership.
@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/unit-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminUnitTypesController {
  constructor(@Inject(VendorsService) private readonly vendors: VendorsService) {}

  @Get()
  @ApiOkResponse({
    description: 'All unit types including inactive ones.',
    type: UnitTypeListEnvelopeDto
  })
  async list(): Promise<ListEnvelope<UnitTypeRecord>> {
    const items = await this.vendors.adminListUnitTypes();
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Post()
  @ApiCreatedResponse({ description: 'Created unit type.', type: UnitTypeEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid unit type input or duplicate code.' })
  @ApiBody({ type: CreateUnitTypeDto })
  async create(@Body() input: CreateUnitTypeDto): Promise<SuccessEnvelope<UnitTypeRecord>> {
    return createSuccessEnvelope(await this.vendors.adminCreateUnitType(input));
  }

  @Patch(':id')
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({ description: 'Updated unit type (code is immutable).', type: UnitTypeEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid unit type input.' })
  @ApiNotFoundResponse({ description: 'Unit type was not found.' })
  @ApiBody({ type: UpdateUnitTypeDto })
  async update(
    @Param() params: UnitTypeIdParamDto,
    @Body() input: UpdateUnitTypeDto
  ): Promise<SuccessEnvelope<UnitTypeRecord>> {
    return createSuccessEnvelope(await this.vendors.adminUpdateUnitType(params.id, input));
  }
}
