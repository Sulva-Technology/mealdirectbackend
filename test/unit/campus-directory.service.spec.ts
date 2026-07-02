import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { EnvService } from '../../src/config/env.service.js';
import { CampusDirectoryService } from '../../src/modules/campuses/campus-directory.service.js';
import type {
  CampusDirectoryRepositoryContract,
  CampusLocationRecord,
  CampusRecord,
  CampusZoneRecord,
  DeliverySlotRecord,
  CreateCampusInput
} from '../../src/modules/campuses/campus-directory.types.js';

const campusId = '11111111-1111-4111-8111-111111111111';
const otherCampusId = '22222222-2222-4222-8222-222222222222';

const superAdmin: AuthenticatedActor = {
  userId: '33333333-3333-4333-8333-333333333333',
  role: 'super_admin'
};

const campusAdmin: AuthenticatedActor = {
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'campus_admin',
  campusId
};

const customer: AuthenticatedActor = {
  userId: '55555555-5555-4555-8555-555555555555',
  role: 'customer'
};

const campus: CampusRecord = {
  id: campusId,
  name: 'Venite University',
  slug: 'venite-university',
  timezone: 'Africa/Lagos',
  currency: 'NGN',
  countryCode: 'NG',
  maxServiceFeeKobo: 20000,
  active: true,
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z'
};

const zone: CampusZoneRecord = {
  id: '66666666-6666-4666-8666-666666666666',
  campusId,
  active: true,
  code: 'ZONE_A',
  deliveryFeeKobo: 15000,
  createdAt: '2026-06-15T08:00:00.000Z',
  displayOrder: 1,
  name: 'Zone A',
  updatedAt: '2026-06-15T08:00:00.000Z'
};

const location: CampusLocationRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  campusId,
  active: true,
  createdAt: '2026-06-15T08:00:00.000Z',
  deliveryInstructions: null,
  displayOrder: 1,
  name: 'Hall One',
  slug: 'hall-one',
  type: 'hostel',
  updatedAt: '2026-06-15T08:00:00.000Z',
  zoneCode: 'ZONE_A',
  zoneId: zone.id,
  zoneName: 'Zone A'
};

const slot: DeliverySlotRecord = {
  id: '88888888-8888-4888-8888-888888888888',
  campusId,
  acceptingOrders: null,
  active: true,
  createdAt: '2026-06-15T08:00:00.000Z',
  cutoffMinutes: 60,
  deliveryTime: '14:00:00',
  displayOrder: 1,
  name: 'Lunch',
  orderingCutoffAt: null,
  updatedAt: '2026-06-15T08:00:00.000Z'
};

function createRepository(): CampusDirectoryRepositoryContract {
  return {
    listPublicCampuses: vi.fn().mockResolvedValue([campus]),
    listAdminCampuses: vi.fn().mockResolvedValue([campus]),
    createCampus: vi.fn().mockResolvedValue(campus),
    updateCampus: vi.fn().mockResolvedValue(campus),
    listPublicLocations: vi.fn().mockResolvedValue([]),
    listAdminLocations: vi.fn().mockResolvedValue([]),
    createLocation: vi.fn().mockResolvedValue(location),
    updateLocation: vi.fn().mockResolvedValue(undefined),
    deleteLocation: vi.fn().mockResolvedValue(true),
    listPublicDeliverySlots: vi.fn().mockResolvedValue([]),
    listAdminDeliverySlots: vi.fn().mockResolvedValue([]),
    createDeliverySlot: vi.fn().mockResolvedValue(slot),
    updateDeliverySlot: vi.fn().mockResolvedValue(undefined),
    listAdminZones: vi.fn().mockResolvedValue([]),
    createZone: vi.fn().mockResolvedValue(zone),
    updateZone: vi.fn().mockResolvedValue(zone)
  };
}

function createEnv(maxOrderTotalKobo = 249000): EnvService {
  return { get: () => maxOrderTotalKobo } as unknown as EnvService;
}

describe('CampusDirectoryService', () => {
  let repository: CampusDirectoryRepositoryContract;
  let service: CampusDirectoryService;

  beforeEach(() => {
    repository = createRepository();
    service = new CampusDirectoryService(repository, createEnv());
  });

  it('lists only active public campuses for unauthenticated surfaces', async () => {
    await expect(service.listPublicCampuses()).resolves.toEqual([campus]);
    expect(repository.listPublicCampuses).toHaveBeenCalledOnce();
  });

  it('scopes campus admin campus listing to their own campus', async () => {
    await service.listAdminCampuses(campusAdmin);

    expect(repository.listAdminCampuses).toHaveBeenCalledWith(campusId);
  });

  it('allows super admins to create campuses', async () => {
    const input: CreateCampusInput = {
      name: 'New Campus',
      slug: 'new-campus',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
      countryCode: 'NG',
      active: true
    };

    await expect(service.createCampus(superAdmin, input)).resolves.toEqual(campus);
    expect(repository.createCampus).toHaveBeenCalledWith(input);
  });

  it('denies non-admin users from admin writes', async () => {
    await expect(service.createCampus(customer, campus)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createCampus).not.toHaveBeenCalled();
  });

  it('prevents campus admins from mutating other campuses', async () => {
    await expect(
      service.updateCampus(campusAdmin, otherCampusId, { active: false })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateCampus).not.toHaveBeenCalled();
  });

  it('updates a zone delivery fee within the order maximum', async () => {
    await service.updateZone(superAdmin, zone.id, { deliveryFeeKobo: 20000 });
    expect(repository.updateZone).toHaveBeenCalledWith(
      zone.id,
      { deliveryFeeKobo: 20000 },
      undefined
    );
  });

  it('scopes a campus admin zone fee update to their campus', async () => {
    await service.updateZone(campusAdmin, zone.id, { deliveryFeeKobo: 20000 });
    expect(repository.updateZone).toHaveBeenCalledWith(
      zone.id,
      { deliveryFeeKobo: 20000 },
      campusId
    );
  });

  it('rejects a zone delivery fee above the order maximum', async () => {
    service = new CampusDirectoryService(repository, createEnv(15000));
    await expect(
      service.updateZone(superAdmin, zone.id, { deliveryFeeKobo: 20000 })
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.updateZone).not.toHaveBeenCalled();
  });

  it('rejects a campus service-fee ceiling above the order maximum', async () => {
    service = new CampusDirectoryService(repository, createEnv(20000));
    await expect(
      service.updateCampus(superAdmin, campusId, { maxServiceFeeKobo: 25000 })
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.updateCampus).not.toHaveBeenCalled();
  });

  it('allows campus admins to manage zones, locations, and slots in their campus', async () => {
    await service.createZone(campusAdmin, campusId, {
      active: true,
      code: 'ZONE_A',
      displayOrder: 1,
      name: 'Zone A'
    });
    await service.createLocation(campusAdmin, campusId, {
      active: true,
      deliveryInstructions: null,
      displayOrder: 1,
      name: 'Hall One',
      slug: 'hall-one',
      type: 'hostel',
      zoneId: '66666666-6666-4666-8666-666666666666'
    });
    await service.createDeliverySlot(campusAdmin, campusId, {
      active: true,
      cutoffMinutes: 60,
      deliveryTime: '14:00',
      displayOrder: 1,
      name: 'Lunch'
    });

    expect(repository.createZone).toHaveBeenCalledOnce();
    expect(repository.createLocation).toHaveBeenCalledOnce();
    expect(repository.createDeliverySlot).toHaveBeenCalledOnce();
  });

  it('deletes a location and scopes a campus admin to their own campus', async () => {
    await service.deleteLocation(campusAdmin, location.id);
    expect(repository.deleteLocation).toHaveBeenCalledWith(location.id, campusId);
  });

  it('lets a super admin delete any location without campus scoping', async () => {
    await service.deleteLocation(superAdmin, location.id);
    expect(repository.deleteLocation).toHaveBeenCalledWith(location.id, undefined);
  });

  it('returns 404 when the location to delete does not exist or is out of scope', async () => {
    (repository.deleteLocation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(service.deleteLocation(superAdmin, location.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('maps a foreign-key violation to a 409 suggesting deactivation', async () => {
    (repository.deleteLocation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('violates foreign key constraint'), { code: '23503' })
    );
    await expect(service.deleteLocation(superAdmin, location.id)).rejects.toBeInstanceOf(
      ConflictException
    );
  });
});
