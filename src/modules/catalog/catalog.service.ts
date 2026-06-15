import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { CatalogRepository } from './catalog.repository.js';
import type {
  CatalogRepositoryContract,
  CatalogVendor,
  MenuFilters,
  MenuItem,
  VendorListFilters
} from './catalog.types.js';

function assertDateAndSlotTogether(filters: { date?: string; slotId?: string }): void {
  if ((filters.date === undefined) !== (filters.slotId === undefined)) {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_FAILED,
      message: 'date and slotId filters must be provided together.'
    });
  }
}

@Injectable()
export class CatalogService {
  constructor(@Inject(CatalogRepository) private readonly repository: CatalogRepositoryContract) {}

  async listVendors(filters: VendorListFilters): Promise<CatalogVendor[]> {
    assertDateAndSlotTogether(filters);
    return this.repository.listVendors(filters);
  }

  async getVendor(vendorId: string): Promise<CatalogVendor> {
    const vendor = await this.repository.findVendorById(vendorId);
    if (vendor === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Vendor was not found.'
      });
    }
    return vendor;
  }

  async listVendorMenu(vendorId: string, filters: MenuFilters): Promise<MenuItem[]> {
    assertDateAndSlotTogether(filters);
    return this.repository.listMenuItems(vendorId, filters);
  }
}
