import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';
import type { PaystackClientContract } from '../../src/modules/payments/payments.types.js';
import { VendorsService } from '../../src/modules/vendors/vendors.service.js';
import { createMediaServiceMock, createStorageServiceMock } from '../helpers/storage-mocks.js';
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
const soupOptionId = '99999999-9999-4999-8999-999999999990';

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
  serviceFeeKobo: null,
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
  countsTowardSpoonLimit: true,
  requiresSoup: false,
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
    findCampusMaxServiceFeeKobo: vi.fn().mockResolvedValue(20000),
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
    listAllUnitTypes: vi.fn().mockResolvedValue([]),
    createUnitType: vi.fn().mockResolvedValue({
      id: unitTypeId,
      code: 'spoon',
      displayName: 'Spoon',
      countsTowardSpoonLimit: true,
      triggersTakeawayFee: true,
      maxQuantity: null,
      active: true
    }),
    updateUnitType: vi.fn().mockResolvedValue({
      id: unitTypeId,
      code: 'spoon',
      displayName: 'Spoon',
      countsTowardSpoonLimit: true,
      triggersTakeawayFee: true,
      maxQuantity: null,
      active: true
    }),
    listVendorSoupOptions: vi.fn().mockResolvedValue([]),
    createVendorSoupOption: vi.fn().mockResolvedValue({
      id: soupOptionId,
      vendorId,
      name: 'Egusi',
      active: true,
      displayOrder: 0,
      createdAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z'
    }),
    updateVendorSoupOption: vi.fn().mockResolvedValue({
      id: soupOptionId,
      vendorId,
      name: 'Egusi',
      active: false,
      displayOrder: 0,
      createdAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z'
    }),
    listMenuItems: vi.fn().mockResolvedValue([menuItem]),
    findMenuItemById: vi.fn().mockResolvedValue(menuItem),
    upsertMenuItem: vi.fn().mockResolvedValue(menuItem),
    setMenuItemActive: vi.fn().mockResolvedValue(menuItem),
    findMenuItemOwner: vi.fn().mockResolvedValue(vendorId),
    listVendorAvailability: vi.fn().mockResolvedValue([]),
    replaceVendorAvailability: vi.fn().mockResolvedValue([]),
    listMenuItemAvailability: vi.fn().mockResolvedValue([]),
    replaceMenuItemAvailability: vi.fn().mockResolvedValue([]),
    regenerateInventoryHorizon: vi.fn().mockResolvedValue(undefined),
    getStoreAvailability: vi.fn().mockResolvedValue(undefined),
    upsertStoreAvailability: vi.fn().mockImplementation((_id: string, state) => Promise.resolve(state))
  };
}

function createAuth(): SupabaseAuthService {
  return {
    setUserAppMetadata: vi.fn().mockResolvedValue(undefined)
  } as unknown as SupabaseAuthService;
}

function createPaystack(): PaystackClientContract {
  return {
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    createRefund: vi.fn(),
    createTransferRecipient: vi.fn().mockResolvedValue({
      recipientCode: 'RCP_provisioned',
      providerPayload: {}
    }),
    fetchTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn()
  };
}

describe('VendorsService', () => {
  let repository: VendorsRepositoryContract;
  let auth: SupabaseAuthService;
  let paystack: PaystackClientContract;
  let media: ReturnType<typeof createMediaServiceMock>;
  let storage: ReturnType<typeof createStorageServiceMock>;
  let service: VendorsService;

  beforeEach(() => {
    repository = createRepository();
    auth = createAuth();
    paystack = createPaystack();
    media = createMediaServiceMock();
    storage = createStorageServiceMock();
    service = new VendorsService(repository, auth, paystack, media, storage);
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
          autoApprove: false
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
      const fkViolation = Object.assign(new Error('fk violation'), {
        code: '23503',
        constraint: 'vendors_campus_id_fkey'
      });
      vi.mocked(repository.onboardVendor).mockRejectedValue(fkViolation);

      await expect(service.onboardVendor(onboardActor, input)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(auth.setUserAppMetadata).not.toHaveBeenCalled();
    });

    it('does not mislabel a non-campus foreign key violation as a bad campus', async () => {
      const fkViolation = Object.assign(new Error('fk violation'), {
        code: '23503',
        constraint: 'vendor_users_user_id_fkey'
      });
      vi.mocked(repository.onboardVendor).mockRejectedValue(fkViolation);

      await expect(service.onboardVendor(onboardActor, input)).rejects.toBe(fkViolation);
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

  it('persists a vendor service fee within the campus ceiling', async () => {
    await service.updateProfile(actor, vendorId, { serviceFeeKobo: 15000 });

    expect(repository.findCampusMaxServiceFeeKobo).toHaveBeenCalledWith(vendorId);
    expect(repository.updateVendorProfile).toHaveBeenCalledWith(vendorId, {
      serviceFeeKobo: 15000
    });
  });

  it('clears the vendor service fee override when null is supplied', async () => {
    await service.updateProfile(actor, vendorId, { serviceFeeKobo: null });

    expect(repository.findCampusMaxServiceFeeKobo).not.toHaveBeenCalled();
    expect(repository.updateVendorProfile).toHaveBeenCalledWith(vendorId, {
      serviceFeeKobo: null
    });
  });

  it('rejects a vendor service fee above the campus ceiling', async () => {
    vi.mocked(repository.findCampusMaxServiceFeeKobo).mockResolvedValue(20000);

    await expect(
      service.updateProfile(actor, vendorId, { serviceFeeKobo: 25000 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateVendorProfile).not.toHaveBeenCalled();
  });

  it('provisions a Paystack recipient from the full account number and stores only the mask', async () => {
    await service.upsertPayoutAccount(actor, vendorId, {
      accountName: 'Ada Kitchen',
      accountNumber: '0123453210',
      bankCode: '001',
      bankName: 'Test Bank'
    });

    expect(paystack.createTransferRecipient).toHaveBeenCalledWith({
      name: 'Ada Kitchen',
      accountNumber: '0123453210',
      bankCode: '001',
      currency: 'NGN'
    });
    expect(repository.upsertPayoutAccount).toHaveBeenCalledWith(vendorId, {
      accountName: 'Ada Kitchen',
      bankCode: '001',
      bankName: 'Test Bank',
      maskedAccountNumber: '******3210',
      paystackRecipientCode: 'RCP_provisioned'
    });
  });

  it('reuses a caller-supplied recipient code instead of provisioning a new one', async () => {
    await service.upsertPayoutAccount(actor, vendorId, {
      accountName: 'Ada Kitchen',
      accountNumber: '0123453210',
      bankCode: '001',
      bankName: 'Test Bank',
      paystackRecipientCode: 'RCP_existing'
    });

    expect(paystack.createTransferRecipient).not.toHaveBeenCalled();
    expect(repository.upsertPayoutAccount).toHaveBeenCalledWith(
      expect.objectContaining({}) as never,
      expect.objectContaining({ paystackRecipientCode: 'RCP_existing' })
    );
  });

  it('rejects a payout account without a bank code that cannot be provisioned', async () => {
    await expect(
      service.upsertPayoutAccount(actor, vendorId, {
        accountName: 'Ada Kitchen',
        accountNumber: '0123453210',
        bankName: 'Test Bank'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(paystack.createTransferRecipient).not.toHaveBeenCalled();
    expect(repository.upsertPayoutAccount).not.toHaveBeenCalled();
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

  it('returns default store availability when no row exists', async () => {
    const state = await service.getStoreAvailability(actor, vendorId);

    expect(state).toEqual({
      acceptingOrders: false,
      state: 'closed',
      pauseUntil: null,
      cutoffTime: null,
      maxOrdersPerDay: null,
      unavailableDates: []
    });
  });

  it('merges a partial store availability update onto defaults and never writes cutoffTime', async () => {
    (repository.getStoreAvailability as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      acceptingOrders: false,
      state: 'closed',
      pauseUntil: null,
      cutoffTime: '21:00:00',
      maxOrdersPerDay: null,
      unavailableDates: []
    });

    const updated = await service.updateStoreAvailability(actor, vendorId, {
      acceptingOrders: true,
      state: 'open'
    });

    expect(updated).toEqual({
      acceptingOrders: true,
      state: 'open',
      pauseUntil: null,
      cutoffTime: '21:00:00',
      maxOrdersPerDay: null,
      unavailableDates: []
    });
    const [, persisted] = (repository.upsertStoreAvailability as ReturnType<typeof vi.fn>).mock
      .calls[0] ?? [];
    expect(persisted.cutoffTime).toBe('21:00:00');
  });

  describe('image uploads', () => {
    it('issues a menu item image upload scoped to the vendor and item', async () => {
      await service.issueMenuItemImageUpload(actor, vendorId, menuItemId, {
        contentType: 'image/webp',
        sizeBytes: 2048
      });

      expect(media.issueUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'menu-item-images',
          ownerPrefix: `${vendorId}/${menuItemId}`
        })
      );
    });

    it('refuses to issue an upload URL for another vendor', async () => {
      const intruder: AuthenticatedActor = { userId, role: 'vendor', vendorId: otherVendorId };
      await expect(
        service.issueMenuItemImageUpload(intruder, vendorId, menuItemId, {
          contentType: 'image/webp',
          sizeBytes: 2048
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(media.issueUpload).not.toHaveBeenCalled();
    });

    it('refuses to issue an upload URL for a menu item owned by another vendor', async () => {
      vi.mocked(repository.findMenuItemOwner).mockResolvedValue(otherVendorId);
      await expect(
        service.issueMenuItemImageUpload(actor, vendorId, menuItemId, {
          contentType: 'image/webp',
          sizeBytes: 2048
        })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(media.issueUpload).not.toHaveBeenCalled();
    });

    it('confirms an image, persists the key, and cleans up the previous object', async () => {
      vi.mocked(repository.findMenuItemById).mockResolvedValue({
        ...menuItem,
        imageUrl: `${vendorId}/${menuItemId}/old.webp`
      });
      const key = `${vendorId}/${menuItemId}/new.webp`;

      await service.confirmMenuItemImage(actor, vendorId, menuItemId, key);

      expect(media.confirmUpload).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'menu-item-images', key })
      );
      expect(repository.upsertMenuItem).toHaveBeenCalledWith(vendorId, menuItemId, {
        imageUrl: key
      });
      expect(media.removeIfKey).toHaveBeenCalledWith(
        'menu-item-images',
        `${vendorId}/${menuItemId}/old.webp`
      );
    });

    it('issues a logo upload scoped to the vendor prefix', async () => {
      await service.issueLogoUpload(actor, vendorId, {
        contentType: 'image/png',
        sizeBytes: 1024
      });

      expect(media.issueUpload).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'vendor-logos', ownerPrefix: vendorId })
      );
    });
  });

  describe('soup options', () => {
    it('creates a trimmed soup option scoped to the vendor', async () => {
      await service.createSoupOption(actor, vendorId, { name: '  Egusi  ' });

      expect(repository.createVendorSoupOption).toHaveBeenCalledWith(vendorId, { name: 'Egusi' });
    });

    it('rejects a blank soup name', async () => {
      await expect(
        service.createSoupOption(actor, vendorId, { name: '   ' })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createVendorSoupOption).not.toHaveBeenCalled();
    });

    it('maps a duplicate soup name to a bad request', async () => {
      vi.mocked(repository.createVendorSoupOption).mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.createSoupOption(actor, vendorId, { name: 'Egusi' })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns not found when updating a soup the vendor does not own', async () => {
      vi.mocked(repository.updateVendorSoupOption).mockResolvedValueOnce(undefined);

      await expect(
        service.updateSoupOption(actor, vendorId, soupOptionId, { active: false })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deactivates a soup option', async () => {
      const result = await service.updateSoupOption(actor, vendorId, soupOptionId, {
        active: false
      });

      expect(repository.updateVendorSoupOption).toHaveBeenCalledWith(vendorId, soupOptionId, {
        active: false
      });
      expect(result.active).toBe(false);
    });
  });
});
