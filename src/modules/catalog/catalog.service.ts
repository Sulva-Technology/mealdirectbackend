import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBuckets } from '../storage/storage.constants.js';
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
  constructor(
    @Inject(CatalogRepository) private readonly repository: CatalogRepositoryContract,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  // Private buckets: logo/image keys are batch-signed into short-lived read URLs on
  // the customer-facing (highest volume) path with a single Storage round trip.
  private async signVendors(vendors: CatalogVendor[]): Promise<CatalogVendor[]> {
    const signed = await this.storage.signKeys(
      StorageBuckets.vendorLogos,
      vendors.map((vendor) => vendor.logoUrl)
    );
    return vendors.map((vendor, index) => ({
      ...vendor,
      logoUrl: (signed[index] as string | null) ?? null
    }));
  }

  private async signMenuItems(items: MenuItem[]): Promise<MenuItem[]> {
    const signed = await this.storage.signKeys(
      StorageBuckets.menuItemImages,
      items.map((item) => item.imageUrl)
    );
    return items.map((item, index) => ({
      ...item,
      imageUrl: (signed[index] as string | null) ?? null
    }));
  }

  async listVendors(filters: VendorListFilters): Promise<CatalogVendor[]> {
    assertDateAndSlotTogether(filters);
    return this.signVendors(await this.repository.listVendors(filters));
  }

  async getVendor(vendorId: string): Promise<CatalogVendor> {
    const vendor = await this.repository.findVendorById(vendorId);
    if (vendor === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Vendor was not found.'
      });
    }
    const [signed] = await this.signVendors([vendor]);
    return signed ?? vendor;
  }

  async listVendorMenu(vendorId: string, filters: MenuFilters): Promise<MenuItem[]> {
    assertDateAndSlotTogether(filters);
    return this.signMenuItems(await this.repository.listMenuItems(vendorId, filters));
  }
}
