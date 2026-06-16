import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import {
  CatalogVendorEnvelopeDto,
  CatalogVendorListEnvelopeDto,
  MenuItemListEnvelopeDto,
  VendorIdParamDto,
  VendorListQueryDto,
  VendorMenuQueryDto
} from './dto/catalog.dto.js';
import { CatalogService } from './catalog.service.js';
import type { CatalogVendor, MenuItem } from './catalog.types.js';

function listEnvelope<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, {
    hasMore: false,
    limit: items.length
  });
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('vendors')
  @ApiOkResponse({
    description: 'Approved active vendors available for the selected campus/date/slot.',
    type: CatalogVendorListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid catalog filters.' })
  async listVendors(@Query() query: VendorListQueryDto): Promise<ListEnvelope<CatalogVendor>> {
    return listEnvelope(await this.catalog.listVendors(query));
  }

  @Get('vendors/:vendorId')
  @ApiOkResponse({ description: 'Approved active vendor detail.', type: CatalogVendorEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid vendor ID.' })
  @ApiNotFoundResponse({ description: 'Vendor not found or unavailable.' })
  async getVendor(@Param() params: VendorIdParamDto): Promise<SuccessEnvelope<CatalogVendor>> {
    return createSuccessEnvelope(await this.catalog.getVendor(params.vendorId));
  }

  @Get('vendors/:vendorId/menu')
  @ApiOkResponse({
    description: 'Approved active menu items for the vendor.',
    type: MenuItemListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid vendor ID or menu filters.' })
  async listVendorMenu(
    @Param() params: VendorIdParamDto,
    @Query() query: VendorMenuQueryDto
  ): Promise<ListEnvelope<MenuItem>> {
    return listEnvelope(await this.catalog.listVendorMenu(params.vendorId, query));
  }
}
