import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';
import { VendorsService } from '../../src/modules/vendors/vendors.service.js';
import type {
  MenuItemRecord,
  UpsertMenuItemInput,
  VendorAvailabilityEntry,
  VendorProfile,
  VendorsRepositoryContract
} from '../../src/modules/vendors/vendors.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const otherVendorId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const slotId = '44444444-4444-4444-8444-444444444444';
const menuItemId = '55555555-5555-4555-8555-555555555555';
const categoryId = '66666666-6666-4666-8666-666666666666';
const unitTypeId = '77777777-7777-4777-8777-777777777777';

const actor: AuthenticatedActor = {
  userId,
  role: 'vendor',
  vendorId
};

const vendorProfile: VendorProfile = {
  id: vendorId,
  campusId: '88888888-8888-4888-8888-888888888888',
  legalName: 'Ada Kitchen Limited',
  displayName: 'Ada Kitchen',
  slug: 'ada-kitchen',
  description: 'Campus meals',
  phone: '+2348012345678',
  email: 'vendor@example.com',
  logoUrl: null,
  kitchenLocation: 'Main gate',
  status: 'approved',
  active: true,
  defaultDeliveryMode: 'meal_direct_rider',
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z'
};

const menuItem: MenuItemRecord = {
  id: menuItemId,
  vendorId,
  categoryId,
  categoryName: 'Meals',
  unitTypeId,
  unitCode: 'plate',
  name: 'Jollof Rice',
  description: null,
  imageUrl: null,
  priceKobo: 250000,
  active: true,
  displayOrder: 0,
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z'
};

function createRepository(): VendorsRepositoryContract {
  return {
    assertVendorAccess: vi.fn().mockResolvedValue(true),
    findVendorIdForUser: vi.fn().mockResolvedValue(undefined),
    onboardVendor: vi.fn().mockResolvedValue(vendorProfile),
    findVendorProfile: vi.fn().mockResolvedValue(vendorProfile),
    updateVendorProfile: vi.fn().mockResolvedValue(vendorProfile),
    findActivePayoutAccount: vi.fn().mockResolvedValue(undefined),
    upsertPayoutAccount: vi.fn().mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      vendorId,
      paystackRecipientCode: null,
      bankName: 'Test Bank',
      bankCode: '001',
      maskedAccountNumber: '******3210',
      accountName: 'Ada Kitchen',
      verifiedAt: null,
      active: true,
      createdAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z'
    }),
    listMenuCategories: vi.fn().mockResolvedValue([]),
    upsertMenuCategory: vi.fn().mockResolvedValue({
      id: categoryId,
      vendorId,
      name: 'Meals',
      slug: 'meals',
      active: true,
      displayOrder: 0,
      createdAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z'
    }),
    findMenuCategoryOwner: vi.fn().mockResolvedValue(vendorId),
    listUnitTypes: vi.fn().mockResolvedValue([]),
    listMenuItems: vi.fn().mockResolvedValue([menuItem]),
    findMenuItemById: vi.fn().mockResolvedValue(menuItem),
    upsertMenuItem: vi.fn().mockResolvedValue(menuItem),
    setMenuItemActive: vi.fn().mockResolvedValue(menuItem),
    findMenuItemOwner: vi.fn().mockResolvedValue(vendorId),
    listVendorAvailability: vi.fn().mockResolvedValue([]),
    replaceVendorAvailability: vi.fn().mockResolvedValue([]),
    listMenuItemAvailability: vi.fn().mockResolvedValue([]),
    replaceMenuItemAvailability: vi.fn().mockResolvedValue([]),
    regenerateInventoryHorizon: vi.fn().mockResolvedValue(undefined)
  };
}

function createAuth(): SupabaseAuthService {
  return {
    setUserAppMetadata: vi.fn().mockResolvedValue(undefined)
  } as unknown as SupabaseAuthService;
}

describe('VendorsService', () => {
  let repository: VendorsRepositoryContract;
  let auth: SupabaseAuthService;
  let service: VendorsService;

  beforeEach(() => {
    repository = createRepository();
    auth = createAuth();
    service = new VendorsService(repository, auth);
  });

  describe('onboardVendor', () => {
    const onboardActor: AuthenticatedActor = { userId, role: 'vendor' };
    const input = {
      campusId: '88888888-8888-4888-8888-888888888888',
      legalName: 'Ada Kitchen Limited',
      displayName: 'Ada Kitchen'
    };

    it('provisions a vendor and writes app_metadata, requiring a token refresh', async () => {
      const result = await service.onboardVendor(onboardActor, input);

      expect(repository.onboardVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          campusId: input.campusId,
          legalName: 'Ada Kitchen Limited',
          displayName: 'Ada Kitchen',
          slug: 'ada-kitchen',
          userId,
          autoApprove: true
        })
      );
      expect(auth.setUserAppMetadata).toHaveBeenCalledWith(userId, {
        meal_direct_role: 'vendor',
        vendor_id: vendorId
      });
      expect(result).toEqual({ vendor: vendorProfile, tokenRefreshRequired: true });
    });

    it('rejects onboarding when the account is already linked to a vendor', async () => {
      vi.mocked(repository.findVendorIdForUser).mockResolvedValue(vendorId);

      await expect(service.onboardVendor(onboardActor, input)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repository.onboardVendor).not.toHaveBeenCalled();
      expect(auth.setUserAppMetadata).not.toHaveBeenCalled();
    });

    it('retries with a suffixed slug when the handle collides', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      vi.mocked(repository.onboardVendor)
        .mockRejectedValueOnce(uniqueViolation)
        .mockResolvedValueOnce(vendorProfile);

      const result = await service.onboardVendor(onboardActor, input);

      expect(repository.onboardVendor).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(repository.onboardVendor).mock.calls[1];
      expect(secondCall?.[0].slug).toMatch(/^ada-kitchen-[a-z0-9]{4}$/);
      expect(result.tokenRefreshRequired).toBe(true);
    });

    it('maps an unknown campus (foreign key violation) to a bad request', async () => {
      const fkViolation = Object.assign(new Error('fk violation'), { code: '23503' });
      vi.mocked(repository.onboardVendor).mockRejectedValue(fkViolation);

      await expect(service.onboardVendor(onboardActor, input)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(auth.setUserAppMetadata).not.toHaveBeenCalled();
    });
  });

  it('requires vendor object access before returning a vendor profile', async () => {
    vi.mocked(repository.assertVendorAccess).mockResolvedValue(false);

    await expect(service.getProfile(actor, otherVendorId)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(repository.findVendorProfile).not.toHaveBeenCalled();
  });

  it('maps a missing vendor profile to not found after access is proven', async () => {
    vi.mocked(repository.findVendorProfile).mockResolvedValue(undefined);

    await expect(service.getProfile(actor, vendorId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normalizes vendor profile updates before persistence', async () => {
    await service.updateProfile(actor, vendorId, {
      description: ' Campus meals ',
      displayName: ' Ada Kitchen ',
      email: ' orders@example.com ',
      kitchenLocation: '',
      logoUrl: null,
      phone: ' +2348012345678 '
    });

    expect(repository.updateVendorProfile).toHaveBeenCalledWith(vendorId, {
      description: 'Campus meals',
      displayName: 'Ada Kitchen',
      email: 'orders@example.com',
      kitchenLocation: null,
      logoUrl: null,
      phone: '+2348012345678'
    });
  });

  it('stores only a masked payout account number', async () => {
    await service.upsertPayoutAccount(actor, vendorId, {
      accountName: 'Ada Kitchen',
      accountNumber: '0123453210',
      bankCode: '001',
      bankName: 'Test Bank'
    });

    expect(repository.upsertPayoutAccount).toHaveBeenCalledWith(vendorId, {
      accountName: 'Ada Kitchen',
      bankCode: '001',
      bankName: 'Test Bank',
      maskedAccountNumber: '******3210',
      paystackRecipientCode: undefined
    });
  });

  it('denies menu item changes outside the selected vendor', async () => {
    vi.mocked(repository.findMenuItemOwner).mockResolvedValue(otherVendorId);

    const input: UpsertMenuItemInput = {
      categoryId,
      unitTypeId,
      name: 'Jollof Rice',
      priceKobo: 250000
    };

    await expect(service.updateMenuItem(actor, vendorId, menuItemId, input)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repository.upsertMenuItem).not.toHaveBeenCalled();
  });

  it('rejects availability ranges whose start date is after the end date', async () => {
    const entries: VendorAvailabilityEntry[] = [
      {
        vendorId,
        deliverySlotId: slotId,
        dayOfWeek: 1,
        available: true,
        validFrom: '2026-06-20',
        validUntil: '2026-06-19'
      }
    ];

    await expect(
      service.replaceVendorAvailability(actor, vendorId, { entries })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceVendorAvailability).not.toHaveBeenCalled();
  });

  it('regenerates the inventory horizon after replacing vendor availability', async () => {
    const entries: VendorAvailabilityEntry[] = [
      { vendorId, deliverySlotId: slotId, dayOfWeek: 4, available: true }
    ];

    await service.replaceVendorAvailability(actor, vendorId, { entries });

    expect(repository.replaceVendorAvailability).toHaveBeenCalledTimes(1);
    expect(repository.regenerateInventoryHorizon).toHaveBeenCalledWith(vendorId);
  });

  it('regenerates the inventory horizon after replacing menu item schedules', async () => {
    const entries = [{ deliverySlotId: slotId, dayOfWeek: 4, available: true }];

    await service.replaceMenuItemSchedules(actor, vendorId, menuItemId, { entries });

    expect(repository.replaceMenuItemAvailability).toHaveBeenCalledTimes(1);
    expect(repository.regenerateInventoryHorizon).toHaveBeenCalledWith(vendorId);
  });
});
