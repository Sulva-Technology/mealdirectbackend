import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { SupabaseAuthService } from '../auth/supabase-auth.service.js';
import { PaystackClient } from '../payments/paystack.client.js';
import type { PaystackClientContract } from '../payments/payments.types.js';
import { VendorsRepository } from './vendors.repository.js';
import type {
  AvailabilityUpdateInput,
  CreateMenuCategoryInput,
  CreateUnitTypeInput,
  MenuCategoryRecord,
  MenuItemAvailabilityEntry,
  MenuItemRecord,
  MenuItemScheduleUpdateInput,
  MenuMetadata,
  UnitTypeRecord,
  UpdateUnitTypeInput,
  UpsertMenuItemInput,
  VendorAvailabilityEntry,
  VendorOnboardInput,
  VendorPayoutAccount,
  VendorPayoutAccountInput,
  VendorProfile,
  VendorProfileUpdateInput,
  VendorsRepositoryContract
} from './vendors.types.js';

const UNIT_TYPE_CODE_PATTERN = /^[a-z0-9_]+$/;

// Self-service vendors can request onboarding, but only an admin approval can
// make them active. Admin-created invite links are the trusted production path.
const VENDOR_AUTO_APPROVE = false;

export type VendorOnboardResult = {
  vendor: VendorProfile;
  tokenRefreshRequired: boolean;
};

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomSlugSuffix(): string {
  return Math.random()
    .toString(36)
    .slice(2, 6)
    .replace(/[^a-z0-9]/g, '0');
}

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim();
}

function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length < 6) {
    throw badRequest('Account number must contain at least 6 digits.');
  }

  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function scheduleKey(entry: {
  deliverySlotId: string;
  dayOfWeek: number;
  validFrom?: string | null;
  validUntil?: string | null;
}): string {
  return [
    entry.deliverySlotId,
    entry.dayOfWeek,
    entry.validFrom ?? '',
    entry.validUntil ?? ''
  ].join('|');
}

function assertScheduleEntries(
  entries: {
    deliverySlotId: string;
    dayOfWeek: number;
    validFrom?: string | null;
    validUntil?: string | null;
  }[]
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      entry.validFrom !== undefined &&
      entry.validFrom !== null &&
      entry.validUntil !== undefined &&
      entry.validUntil !== null &&
      entry.validFrom > entry.validUntil
    ) {
      throw badRequest('Availability validFrom cannot be after validUntil.');
    }

    const key = scheduleKey(entry);
    if (seen.has(key)) {
      throw badRequest('Availability entries must not contain duplicates.');
    }
    seen.add(key);
  }
}

function normalizeMenuItemInput(input: UpsertMenuItemInput): UpsertMenuItemInput {
  return {
    ...(Object.hasOwn(input, 'categoryId') ? { categoryId: input.categoryId ?? null } : {}),
    ...(input.unitTypeId === undefined ? {} : { unitTypeId: input.unitTypeId }),
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(Object.hasOwn(input, 'description')
      ? { description: normalizeNullableString(input.description) ?? null }
      : {}),
    ...(Object.hasOwn(input, 'imageUrl')
      ? { imageUrl: normalizeNullableString(input.imageUrl) ?? null }
      : {}),
    ...(input.priceKobo === undefined ? {} : { priceKobo: input.priceKobo }),
    ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder })
  };
}

@Injectable()
export class VendorsService {
  constructor(
    @Inject(VendorsRepository) private readonly repository: VendorsRepositoryContract,
    @Inject(SupabaseAuthService) private readonly auth: SupabaseAuthService,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract
  ) {}

  /**
   * Self-service vendor onboarding: provisions the vendor record + owner link and
   * writes meal_direct_role + vendor_id into the caller's app_metadata. The new
   * vendor_id only reaches the JWT after the client refreshes its session, hence
   * tokenRefreshRequired.
   */
  async onboardVendor(
    actor: AuthenticatedActor,
    input: VendorOnboardInput
  ): Promise<VendorOnboardResult> {
    if (actor.role !== 'vendor') {
      throw forbidden('Vendor access is required.');
    }

    const alreadyLinked = await this.repository.findVendorIdForUser(actor.userId);
    if (alreadyLinked !== undefined) {
      throw conflict('This account is already linked to a vendor.');
    }

    const legalName = input.legalName.trim();
    const displayName = input.displayName.trim();
    const phone = normalizeOptionalString(input.phone);
    const baseSlug = slugify(displayName);
    if (baseSlug.length === 0) {
      throw badRequest('Display name must contain at least one letter or digit.');
    }

    let vendor: VendorProfile | undefined;
    for (let attempt = 0; attempt < 4 && vendor === undefined; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;
      try {
        vendor = await this.repository.onboardVendor({
          campusId: input.campusId,
          legalName,
          displayName,
          ...(phone === undefined ? {} : { phone }),
          slug,
          userId: actor.userId,
          autoApprove: VENDOR_AUTO_APPROVE
        });
      } catch (error) {
        const code = postgresErrorCode(error);
        if (code === '23503') {
          // foreign key violation — campus_id does not exist
          throw badRequest('Campus was not found.');
        }
        if (code === '23505' && attempt < 3) {
          // unique (campus_id, slug) collision — retry with a suffixed slug
          continue;
        }
        throw error;
      }
    }

    if (vendor === undefined) {
      throw conflict('Could not generate a unique vendor handle; try a different display name.');
    }

    await this.auth.setUserAppMetadata(actor.userId, {
      meal_direct_role: 'vendor',
      vendor_id: vendor.id
    });

    return { vendor, tokenRefreshRequired: true };
  }

  async getProfile(actor: AuthenticatedActor, vendorId: string): Promise<VendorProfile> {
    await this.assertActorCanUseVendor(actor, vendorId);

    const profile = await this.repository.findVendorProfile(vendorId);
    if (profile === undefined) {
      throw notFound('Vendor was not found.');
    }

    return profile;
  }

  async updateProfile(
    actor: AuthenticatedActor,
    vendorId: string,
    input: VendorProfileUpdateInput
  ): Promise<VendorProfile> {
    await this.assertActorCanUseVendor(actor, vendorId);

    const update: VendorProfileUpdateInput = {};
    const displayName = normalizeOptionalString(input.displayName);
    const description = normalizeNullableString(input.description);
    const phone = normalizeNullableString(input.phone);
    const email = normalizeNullableString(input.email);
    const logoUrl = normalizeNullableString(input.logoUrl);
    const kitchenLocation = normalizeNullableString(input.kitchenLocation);

    if (displayName !== undefined) update.displayName = displayName;
    if (description !== undefined) update.description = description;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    if (kitchenLocation !== undefined) update.kitchenLocation = kitchenLocation;
    if (input.serviceFeeKobo !== undefined) {
      update.serviceFeeKobo = await this.resolveServiceFeeKobo(vendorId, input.serviceFeeKobo);
    }
    if (input.defaultDeliveryMode !== undefined) {
      update.defaultDeliveryMode = input.defaultDeliveryMode;
    }

    const profile = await this.repository.updateVendorProfile(vendorId, update);
    if (profile === undefined) {
      throw notFound('Vendor was not found.');
    }

    return profile;
  }

  // Validate a vendor's requested takeaway/packaging fee against the campus-set ceiling.
  // null clears the override back to the global default.
  private async resolveServiceFeeKobo(
    vendorId: string,
    requested: number | null
  ): Promise<number | null> {
    if (requested === null) {
      return null;
    }
    const ceiling = await this.repository.findCampusMaxServiceFeeKobo(vendorId);
    if (ceiling === undefined) {
      throw notFound('Vendor was not found.');
    }
    if (requested > ceiling) {
      throw badRequest(
        `serviceFeeKobo may not exceed the campus maximum of ${String(ceiling)} kobo.`
      );
    }
    return requested;
  }

  async getPayoutAccount(
    actor: AuthenticatedActor,
    vendorId: string
  ): Promise<VendorPayoutAccount | null> {
    await this.assertActorCanUseVendor(actor, vendorId);
    return (await this.repository.findActivePayoutAccount(vendorId)) ?? null;
  }

  async upsertPayoutAccount(
    actor: AuthenticatedActor,
    vendorId: string,
    input: VendorPayoutAccountInput
  ): Promise<VendorPayoutAccount> {
    await this.assertActorCanUseVendor(actor, vendorId);

    const accountName = input.accountName.trim();
    const bankName = input.bankName.trim();
    const bankCode = normalizeOptionalString(input.bankCode);
    const suppliedRecipientCode = normalizeOptionalString(input.paystackRecipientCode);

    // Provision the Paystack transfer recipient here, while the full account number
    // is still in hand — it is masked before storage and never persisted, so payouts
    // can only reference the recipient code, not re-derive the account number later.
    let recipientCode = suppliedRecipientCode;
    if (recipientCode === undefined) {
      if (bankCode === undefined || bankCode.length === 0) {
        throw badRequest('bankCode is required to provision payouts for this account.');
      }
      const recipient = await this.paystack.createTransferRecipient({
        name: accountName,
        accountNumber: input.accountNumber,
        bankCode,
        currency: 'NGN'
      });
      recipientCode = recipient.recipientCode;
    }

    return this.repository.upsertPayoutAccount(vendorId, {
      accountName,
      bankName,
      maskedAccountNumber: maskAccountNumber(input.accountNumber),
      paystackRecipientCode: recipientCode,
      ...(bankCode === undefined ? {} : { bankCode })
    });
  }

  async getMenuMetadata(actor: AuthenticatedActor, vendorId: string): Promise<MenuMetadata> {
    await this.assertActorCanUseVendor(actor, vendorId);
    const [categories, unitTypes] = await Promise.all([
      this.repository.listMenuCategories(vendorId),
      this.repository.listUnitTypes()
    ]);

    return { categories, unitTypes };
  }

  async createMenuCategory(
    actor: AuthenticatedActor,
    vendorId: string,
    input: CreateMenuCategoryInput
  ): Promise<MenuCategoryRecord> {
    await this.assertActorCanUseVendor(actor, vendorId);

    const name = input.name.trim();
    const slug = slugify(name);
    if (slug.length === 0) {
      throw badRequest('Category name must contain at least one letter or digit.');
    }

    try {
      return await this.repository.upsertMenuCategory(vendorId, {
        name,
        slug,
        active: true,
        ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder })
      });
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        throw badRequest('Category already exists.');
      }
      throw error;
    }
  }

  // Unit types are a global, admin-managed catalogue shared across all vendors;
  // the admin role guard on the controller is the only authorization gate.
  async adminListUnitTypes(): Promise<UnitTypeRecord[]> {
    return this.repository.listAllUnitTypes();
  }

  async adminCreateUnitType(input: CreateUnitTypeInput): Promise<UnitTypeRecord> {
    const code = input.code.trim().toLowerCase();
    if (!UNIT_TYPE_CODE_PATTERN.test(code)) {
      throw badRequest('Unit type code must match ^[a-z0-9_]+$.');
    }

    try {
      return await this.repository.createUnitType({
        code,
        displayName: input.displayName.trim(),
        countsTowardSpoonLimit: input.countsTowardSpoonLimit ?? false
      });
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        throw badRequest('Unit type code already exists.');
      }
      throw error;
    }
  }

  async adminUpdateUnitType(id: string, input: UpdateUnitTypeInput): Promise<UnitTypeRecord> {
    const update: UpdateUnitTypeInput = {};
    if (input.displayName !== undefined) update.displayName = input.displayName.trim();
    if (input.countsTowardSpoonLimit !== undefined) {
      update.countsTowardSpoonLimit = input.countsTowardSpoonLimit;
    }
    if (input.active !== undefined) update.active = input.active;

    const unitType = await this.repository.updateUnitType(id, update);
    if (unitType === undefined) {
      throw notFound('Unit type was not found.');
    }
    return unitType;
  }

  async listMenuItems(actor: AuthenticatedActor, vendorId: string): Promise<MenuItemRecord[]> {
    await this.assertActorCanUseVendor(actor, vendorId);
    return this.repository.listMenuItems(vendorId);
  }

  async getMenuItem(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string
  ): Promise<MenuItemRecord> {
    await this.assertActorCanUseVendor(actor, vendorId);

    const item = await this.repository.findMenuItemById(vendorId, menuItemId);
    if (item === undefined) {
      throw notFound('Menu item was not found.');
    }

    return item;
  }

  async createMenuItem(
    actor: AuthenticatedActor,
    vendorId: string,
    input: UpsertMenuItemInput
  ): Promise<MenuItemRecord> {
    await this.assertActorCanUseVendor(actor, vendorId);
    await this.assertCategoryBelongsToVendor(vendorId, input.categoryId);

    const item = await this.repository.upsertMenuItem(
      vendorId,
      undefined,
      normalizeMenuItemInput(input)
    );
    if (item === undefined) {
      throw badRequest('Menu item could not be created.');
    }

    return item;
  }

  async updateMenuItem(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string,
    input: UpsertMenuItemInput
  ): Promise<MenuItemRecord> {
    await this.assertActorCanUseVendor(actor, vendorId);
    await this.assertMenuItemBelongsToVendor(vendorId, menuItemId);
    await this.assertCategoryBelongsToVendor(vendorId, input.categoryId);

    const item = await this.repository.upsertMenuItem(
      vendorId,
      menuItemId,
      normalizeMenuItemInput(input)
    );
    if (item === undefined) {
      throw notFound('Menu item was not found.');
    }

    return item;
  }

  async activateMenuItem(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string
  ): Promise<MenuItemRecord> {
    return this.setMenuItemActive(actor, vendorId, menuItemId, true);
  }

  async deactivateMenuItem(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string
  ): Promise<MenuItemRecord> {
    return this.setMenuItemActive(actor, vendorId, menuItemId, false);
  }

  async listVendorAvailability(
    actor: AuthenticatedActor,
    vendorId: string
  ): Promise<VendorAvailabilityEntry[]> {
    await this.assertActorCanUseVendor(actor, vendorId);
    return this.repository.listVendorAvailability(vendorId);
  }

  async replaceVendorAvailability(
    actor: AuthenticatedActor,
    vendorId: string,
    input: AvailabilityUpdateInput
  ): Promise<VendorAvailabilityEntry[]> {
    await this.assertActorCanUseVendor(actor, vendorId);
    assertScheduleEntries(input.entries);

    const result = await this.repository.replaceVendorAvailability(
      vendorId,
      input.entries.map((entry) => ({
        deliverySlotId: entry.deliverySlotId,
        dayOfWeek: entry.dayOfWeek,
        available: entry.available,
        validFrom: entry.validFrom ?? null,
        validUntil: entry.validUntil ?? null
      }))
    );

    // Vendor slot availability gates inventory generation; refresh the horizon so
    // items become stockable today instead of after the nightly cron.
    await this.repository.regenerateInventoryHorizon(vendorId);

    return result;
  }

  async listMenuItemSchedules(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string
  ): Promise<MenuItemAvailabilityEntry[]> {
    await this.assertActorCanUseVendor(actor, vendorId);
    await this.assertMenuItemBelongsToVendor(vendorId, menuItemId);
    return this.repository.listMenuItemAvailability(menuItemId);
  }

  async replaceMenuItemSchedules(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string,
    input: MenuItemScheduleUpdateInput
  ): Promise<MenuItemAvailabilityEntry[]> {
    await this.assertActorCanUseVendor(actor, vendorId);
    await this.assertMenuItemBelongsToVendor(vendorId, menuItemId);
    assertScheduleEntries(input.entries);

    const result = await this.repository.replaceMenuItemAvailability(
      menuItemId,
      input.entries.map((entry) => ({
        deliverySlotId: entry.deliverySlotId,
        dayOfWeek: entry.dayOfWeek,
        available: entry.available,
        validFrom: entry.validFrom ?? null,
        validUntil: entry.validUntil ?? null
      }))
    );

    // Menu-item slot availability gates inventory generation; refresh the horizon
    // so the item becomes stockable today instead of after the nightly cron.
    await this.repository.regenerateInventoryHorizon(vendorId);

    return result;
  }

  private async setMenuItemActive(
    actor: AuthenticatedActor,
    vendorId: string,
    menuItemId: string,
    active: boolean
  ): Promise<MenuItemRecord> {
    await this.assertActorCanUseVendor(actor, vendorId);
    await this.assertMenuItemBelongsToVendor(vendorId, menuItemId);

    const item = await this.repository.setMenuItemActive(vendorId, menuItemId, active);
    if (item === undefined) {
      throw notFound('Menu item was not found.');
    }

    return item;
  }

  private async assertActorCanUseVendor(
    actor: AuthenticatedActor,
    vendorId: string
  ): Promise<void> {
    if (actor.role !== 'vendor' || actor.vendorId !== vendorId) {
      throw forbidden('Vendor access is required.');
    }

    if (!(await this.repository.assertVendorAccess(vendorId, actor.userId))) {
      throw forbidden('Vendor access is required.');
    }
  }

  private async assertMenuItemBelongsToVendor(vendorId: string, menuItemId: string): Promise<void> {
    const ownerVendorId = await this.repository.findMenuItemOwner(menuItemId);
    if (ownerVendorId !== vendorId) {
      throw notFound('Menu item was not found.');
    }
  }

  private async assertCategoryBelongsToVendor(
    vendorId: string,
    categoryId: string | null | undefined
  ): Promise<void> {
    if (categoryId === undefined || categoryId === null) {
      return;
    }

    const ownerVendorId = await this.repository.findMenuCategoryOwner(categoryId);
    if (ownerVendorId !== vendorId) {
      throw badRequest('Menu category must belong to the current vendor.');
    }
  }
}
