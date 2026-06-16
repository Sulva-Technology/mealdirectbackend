import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogService } from '../../src/modules/catalog/catalog.service.js';
import type {
  CatalogRepositoryContract,
  CatalogVendor,
  MenuItem
} from '../../src/modules/catalog/catalog.types.js';

const vendor: CatalogVendor = {
  id: '11111111-1111-4111-8111-111111111111',
  campusId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Ada Kitchen',
  slug: 'ada-kitchen',
  description: 'Campus meals',
  logoUrl: null,
  kitchenLocation: 'Main gate',
  defaultDeliveryMode: 'meal_direct_rider'
};

const menuItem: MenuItem = {
  id: '33333333-3333-4333-8333-333333333333',
  vendorId: vendor.id,
  categoryId: null,
  categoryName: null,
  unitTypeId: '44444444-4444-4444-8444-444444444444',
  unitCode: 'plate',
  name: 'Jollof Rice',
  description: null,
  imageUrl: null,
  priceKobo: 250000,
  remainingQuantity: 10
};

function createRepository(): CatalogRepositoryContract {
  return {
    findVendorById: vi.fn().mockResolvedValue(vendor),
    listMenuItems: vi.fn().mockResolvedValue([menuItem]),
    listVendors: vi.fn().mockResolvedValue([vendor])
  };
}

describe('CatalogService', () => {
  let repository: CatalogRepositoryContract;
  let service: CatalogService;

  beforeEach(() => {
    repository = createRepository();
    service = new CatalogService(repository);
  });

  it('lists vendors with campus, date, slot, and location filters', async () => {
    const query = {
      campusId: vendor.campusId,
      date: '2026-06-15',
      locationId: '55555555-5555-4555-8555-555555555555',
      slotId: '66666666-6666-4666-8666-666666666666'
    };

    await expect(service.listVendors(query)).resolves.toEqual([vendor]);
    expect(repository.listVendors).toHaveBeenCalledWith(query);
  });

  it('requires catalog vendor date and slot filters together', async () => {
    await expect(
      service.listVendors({
        campusId: vendor.campusId,
        date: '2026-06-15'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.listVendors).not.toHaveBeenCalled();
  });

  it('returns vendor detail or not found', async () => {
    await expect(service.getVendor(vendor.id)).resolves.toEqual(vendor);

    vi.mocked(repository.findVendorById).mockResolvedValue(undefined);
    await expect(service.getVendor(vendor.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists menu items and requires date and slot filters together', async () => {
    await expect(
      service.listVendorMenu(vendor.id, {
        date: '2026-06-15',
        slotId: '66666666-6666-4666-8666-666666666666'
      })
    ).resolves.toEqual([menuItem]);
    await expect(service.listVendorMenu(vendor.id, { slotId: menuItem.id })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
