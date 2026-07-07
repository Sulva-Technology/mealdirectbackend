import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CreateUnitTypeInput,
  CreateVendorSoupOptionInput,
  MenuCategoryRecord,
  MenuItemAvailabilityEntry,
  MenuItemRecord,
  UnitTypeRecord,
  UpdateUnitTypeInput,
  UpdateVendorSoupOptionInput,
  UpsertMenuCategoryInput,
  StoreAvailabilityState,
  UpsertMenuItemInput,
  VendorAvailabilityEntry,
  VendorOnboardRepositoryInput,
  VendorPayoutAccount,
  VendorPayoutAccountRecordInput,
  VendorProfile,
  VendorProfileUpdateInput,
  VendorSoupOptionRecord,
  VendorsRepositoryContract
} from './vendors.types.js';

type AccessResult = {
  hasAccess: boolean;
};

type IdResult = {
  id: string;
};

type OwnerResult = {
  vendorId: string;
};

@Injectable()
export class VendorsRepository implements VendorsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<AccessResult>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async findVendorIdForUser(userId: string): Promise<string | undefined> {
    const result = await sql<OwnerResult>`
      select vendor_id::text as "vendorId"
      from public.vendor_users
      where user_id = ${userId}::uuid
        and active
      order by created_at
      limit 1
    `.execute(this.database.db);

    return result.rows[0]?.vendorId;
  }

  async onboardVendor(input: VendorOnboardRepositoryInput): Promise<VendorProfile> {
    return this.database.db.transaction().execute(async (trx) => {
      const inserted = await sql<IdResult>`
        insert into public.vendors (
          campus_id,
          legal_name,
          display_name,
          slug,
          phone,
          status,
          approved_at,
          active
        )
        values (
          ${input.campusId}::uuid,
          ${input.legalName},
          ${input.displayName},
          ${input.slug},
          ${input.phone ?? null},
          ${input.autoApprove ? 'approved' : 'pending'}::public.vendor_status,
          ${input.autoApprove ? sql`now()` : null},
          ${input.autoApprove}
        )
        returning id::text as "id"
      `.execute(trx);

      const vendorId = inserted.rows[0]?.id;
      if (vendorId === undefined) {
        throw new Error('Vendor insert did not return a row.');
      }

      await sql`
        insert into public.vendor_users (vendor_id, user_id, role)
        values (${vendorId}::uuid, ${input.userId}::uuid, 'owner'::public.vendor_user_role)
      `.execute(trx);

      const profile = await sql<VendorProfile>`
        select
          id::text as "id",
          campus_id::text as "campusId",
          legal_name as "legalName",
          display_name as "displayName",
          slug,
          description,
          phone,
          email::text as "email",
          logo_url as "logoUrl",
          kitchen_location as "kitchenLocation",
          service_fee_kobo as "serviceFeeKobo",
          status::text as "status",
          active,
          default_delivery_mode::text as "defaultDeliveryMode",
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
        from public.vendors
        where id = ${vendorId}::uuid
      `.execute(trx);

      const row = profile.rows[0];
      if (row === undefined) {
        throw new Error('Vendor onboarding did not return a profile.');
      }
      return row;
    });
  }

  async findVendorProfile(vendorId: string): Promise<VendorProfile | undefined> {
    const result = await sql<VendorProfile>`
      select
        id::text as "id",
        campus_id::text as "campusId",
        legal_name as "legalName",
        display_name as "displayName",
        slug,
        description,
        phone,
        email::text as "email",
        logo_url as "logoUrl",
        kitchen_location as "kitchenLocation",
        service_fee_kobo as "serviceFeeKobo",
        status::text as "status",
        active,
        default_delivery_mode::text as "defaultDeliveryMode",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.vendors
      where id = ${vendorId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findCampusMaxServiceFeeKobo(vendorId: string): Promise<number | undefined> {
    const result = await sql<{ maxServiceFeeKobo: number }>`
      select c.max_service_fee_kobo as "maxServiceFeeKobo"
      from public.vendors v
      join public.campuses c on c.id = v.campus_id
      where v.id = ${vendorId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.maxServiceFeeKobo;
  }

  async updateVendorProfile(
    vendorId: string,
    input: VendorProfileUpdateInput
  ): Promise<VendorProfile | undefined> {
    const hasDisplayName = Object.hasOwn(input, 'displayName');
    const hasDescription = Object.hasOwn(input, 'description');
    const hasPhone = Object.hasOwn(input, 'phone');
    const hasEmail = Object.hasOwn(input, 'email');
    const hasLogoUrl = Object.hasOwn(input, 'logoUrl');
    const hasKitchenLocation = Object.hasOwn(input, 'kitchenLocation');
    const hasServiceFeeKobo = Object.hasOwn(input, 'serviceFeeKobo');
    const hasDefaultDeliveryMode = Object.hasOwn(input, 'defaultDeliveryMode');

    const result = await sql<VendorProfile>`
      update public.vendors
      set display_name = case
            when ${hasDisplayName} then ${input.displayName ?? null}
            else display_name
          end,
          description = case
            when ${hasDescription} then ${input.description ?? null}
            else description
          end,
          phone = case
            when ${hasPhone} then ${input.phone ?? null}
            else phone
          end,
          email = case
            when ${hasEmail} then ${input.email ?? null}::extensions.citext
            else email
          end,
          logo_url = case
            when ${hasLogoUrl} then ${input.logoUrl ?? null}
            else logo_url
          end,
          kitchen_location = case
            when ${hasKitchenLocation} then ${input.kitchenLocation ?? null}
            else kitchen_location
          end,
          service_fee_kobo = case
            when ${hasServiceFeeKobo} then ${input.serviceFeeKobo ?? null}::integer
            else service_fee_kobo
          end,
          default_delivery_mode = case
            when ${hasDefaultDeliveryMode} then ${input.defaultDeliveryMode ?? null}::public.delivery_mode
            else default_delivery_mode
          end,
          updated_at = now()
      where id = ${vendorId}::uuid
      returning
        id::text as "id",
        campus_id::text as "campusId",
        legal_name as "legalName",
        display_name as "displayName",
        slug,
        description,
        phone,
        email::text as "email",
        logo_url as "logoUrl",
        kitchen_location as "kitchenLocation",
        service_fee_kobo as "serviceFeeKobo",
        status::text as "status",
        active,
        default_delivery_mode::text as "defaultDeliveryMode",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findActivePayoutAccount(vendorId: string): Promise<VendorPayoutAccount | undefined> {
    const result = await sql<VendorPayoutAccount>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        paystack_recipient_code as "paystackRecipientCode",
        bank_name as "bankName",
        bank_code as "bankCode",
        masked_account_number as "maskedAccountNumber",
        account_name as "accountName",
        verified_at::text as "verifiedAt",
        active,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.vendor_payout_accounts
      where vendor_id = ${vendorId}::uuid
        and active
      order by updated_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async upsertPayoutAccount(
    vendorId: string,
    input: VendorPayoutAccountRecordInput
  ): Promise<VendorPayoutAccount> {
    return this.database.db.transaction().execute(async (trx) => {
      await sql`
        update public.vendor_payout_accounts
        set active = false,
            updated_at = now()
        where vendor_id = ${vendorId}::uuid
          and active
      `.execute(trx);

      const result = await sql<VendorPayoutAccount>`
        insert into public.vendor_payout_accounts (
          vendor_id,
          paystack_recipient_code,
          bank_name,
          bank_code,
          masked_account_number,
          account_name,
          active
        )
        values (
          ${vendorId}::uuid,
          ${input.paystackRecipientCode ?? null},
          ${input.bankName},
          ${input.bankCode ?? null},
          ${input.maskedAccountNumber},
          ${input.accountName},
          true
        )
        returning
          id::text as "id",
          vendor_id::text as "vendorId",
          paystack_recipient_code as "paystackRecipientCode",
          bank_name as "bankName",
          bank_code as "bankCode",
          masked_account_number as "maskedAccountNumber",
          account_name as "accountName",
          verified_at::text as "verifiedAt",
          active,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
      `.execute(trx);

      const account = result.rows[0];
      if (account === undefined) {
        throw new Error('Vendor payout account insert did not return a row.');
      }
      return account;
    });
  }

  async listMenuCategories(vendorId: string): Promise<MenuCategoryRecord[]> {
    const result = await sql<MenuCategoryRecord>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        name,
        slug,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.menu_categories
      where vendor_id = ${vendorId}::uuid
      order by active desc, display_order, name
    `.execute(this.database.db);

    return result.rows;
  }

  async upsertMenuCategory(
    vendorId: string,
    input: UpsertMenuCategoryInput
  ): Promise<MenuCategoryRecord> {
    const result = await sql<MenuCategoryRecord>`
      insert into public.menu_categories (vendor_id, name, slug, active, display_order)
      values (
        ${vendorId}::uuid,
        ${input.name},
        ${input.slug},
        ${input.active ?? true},
        ${input.displayOrder ?? 0}
      )
      on conflict (vendor_id, slug)
      do update set
        name = excluded.name,
        active = excluded.active,
        display_order = excluded.display_order,
        updated_at = now()
      returning
        id::text as "id",
        vendor_id::text as "vendorId",
        name,
        slug,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const category = result.rows[0];
    if (category === undefined) {
      throw new Error('Menu category upsert did not return a row.');
    }
    return category;
  }

  async findMenuCategoryOwner(categoryId: string): Promise<string | undefined> {
    const result = await sql<OwnerResult>`
      select vendor_id::text as "vendorId"
      from public.menu_categories
      where id = ${categoryId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.vendorId;
  }

  async listUnitTypes(): Promise<UnitTypeRecord[]> {
    const result = await sql<UnitTypeRecord>`
      select
        id::text as "id",
        code,
        display_name as "displayName",
        counts_toward_spoon_limit as "countsTowardSpoonLimit",
        triggers_takeaway_fee as "triggersTakeawayFee",
        max_quantity as "maxQuantity",
        active
      from public.unit_types
      where active
      order by display_name
    `.execute(this.database.db);

    return result.rows;
  }

  async listAllUnitTypes(): Promise<UnitTypeRecord[]> {
    const result = await sql<UnitTypeRecord>`
      select
        id::text as "id",
        code,
        display_name as "displayName",
        counts_toward_spoon_limit as "countsTowardSpoonLimit",
        triggers_takeaway_fee as "triggersTakeawayFee",
        max_quantity as "maxQuantity",
        active
      from public.unit_types
      order by active desc, display_name
    `.execute(this.database.db);

    return result.rows;
  }

  async createUnitType(input: CreateUnitTypeInput): Promise<UnitTypeRecord> {
    const result = await sql<UnitTypeRecord>`
      insert into public.unit_types (
        code,
        display_name,
        counts_toward_spoon_limit,
        triggers_takeaway_fee,
        max_quantity
      )
      values (
        ${input.code},
        ${input.displayName},
        ${input.countsTowardSpoonLimit ?? false},
        ${input.triggersTakeawayFee ?? false},
        ${input.maxQuantity ?? null}::integer
      )
      returning
        id::text as "id",
        code,
        display_name as "displayName",
        counts_toward_spoon_limit as "countsTowardSpoonLimit",
        triggers_takeaway_fee as "triggersTakeawayFee",
        max_quantity as "maxQuantity",
        active
    `.execute(this.database.db);

    const unitType = result.rows[0];
    if (unitType === undefined) {
      throw new Error('Unit type insert did not return a row.');
    }
    return unitType;
  }

  async updateUnitType(
    id: string,
    input: UpdateUnitTypeInput
  ): Promise<UnitTypeRecord | undefined> {
    const hasDisplayName = Object.hasOwn(input, 'displayName');
    const hasCountsTowardSpoonLimit = Object.hasOwn(input, 'countsTowardSpoonLimit');
    const hasTriggersTakeawayFee = Object.hasOwn(input, 'triggersTakeawayFee');
    const hasMaxQuantity = Object.hasOwn(input, 'maxQuantity');
    const hasActive = Object.hasOwn(input, 'active');

    const result = await sql<UnitTypeRecord>`
      update public.unit_types
      set display_name = case
            when ${hasDisplayName} then ${input.displayName ?? null}
            else display_name
          end,
          counts_toward_spoon_limit = case
            when ${hasCountsTowardSpoonLimit} then ${input.countsTowardSpoonLimit ?? null}
            else counts_toward_spoon_limit
          end,
          triggers_takeaway_fee = case
            when ${hasTriggersTakeawayFee} then ${input.triggersTakeawayFee ?? null}
            else triggers_takeaway_fee
          end,
          max_quantity = case
            when ${hasMaxQuantity} then ${input.maxQuantity ?? null}::integer
            else max_quantity
          end,
          active = case
            when ${hasActive} then ${input.active ?? null}
            else active
          end,
          updated_at = now()
      where id = ${id}::uuid
      returning
        id::text as "id",
        code,
        display_name as "displayName",
        counts_toward_spoon_limit as "countsTowardSpoonLimit",
        triggers_takeaway_fee as "triggersTakeawayFee",
        max_quantity as "maxQuantity",
        active
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listVendorSoupOptions(
    vendorId: string,
    activeOnly: boolean
  ): Promise<VendorSoupOptionRecord[]> {
    const result = await sql<VendorSoupOptionRecord>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        name,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.vendor_soup_options
      where vendor_id = ${vendorId}::uuid
        and (${activeOnly}::boolean is false or active)
      order by active desc, display_order, name
    `.execute(this.database.db);

    return result.rows;
  }

  async createVendorSoupOption(
    vendorId: string,
    input: CreateVendorSoupOptionInput
  ): Promise<VendorSoupOptionRecord> {
    const result = await sql<VendorSoupOptionRecord>`
      insert into public.vendor_soup_options (vendor_id, name, display_order)
      values (
        ${vendorId}::uuid,
        ${input.name},
        ${input.displayOrder ?? 0}
      )
      returning
        id::text as "id",
        vendor_id::text as "vendorId",
        name,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const soup = result.rows[0];
    if (soup === undefined) {
      throw new Error('Soup option insert did not return a row.');
    }
    return soup;
  }

  async updateVendorSoupOption(
    vendorId: string,
    soupOptionId: string,
    input: UpdateVendorSoupOptionInput
  ): Promise<VendorSoupOptionRecord | undefined> {
    const hasName = Object.hasOwn(input, 'name');
    const hasActive = Object.hasOwn(input, 'active');
    const hasDisplayOrder = Object.hasOwn(input, 'displayOrder');

    const result = await sql<VendorSoupOptionRecord>`
      update public.vendor_soup_options
      set name = case
            when ${hasName} then ${input.name ?? null}
            else name
          end,
          active = case
            when ${hasActive} then ${input.active ?? null}
            else active
          end,
          display_order = case
            when ${hasDisplayOrder} then ${input.displayOrder ?? null}
            else display_order
          end,
          updated_at = now()
      where id = ${soupOptionId}::uuid
        and vendor_id = ${vendorId}::uuid
      returning
        id::text as "id",
        vendor_id::text as "vendorId",
        name,
        active,
        display_order as "displayOrder",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listMenuItems(vendorId: string): Promise<MenuItemRecord[]> {
    const result = await sql<MenuItemRecord>`
      select
        mi.id::text as "id",
        mi.vendor_id::text as "vendorId",
        mi.category_id::text as "categoryId",
        mc.name as "categoryName",
        mi.unit_type_id::text as "unitTypeId",
        ut.code as "unitCode",
        mi.name,
        mi.description,
        mi.image_url as "imageUrl",
        mi.price_kobo as "priceKobo",
        ut.counts_toward_spoon_limit as "countsTowardSpoonLimit",
        mi.requires_soup as "requiresSoup",
        mi.active,
        mi.display_order as "displayOrder",
        mi.created_at::text as "createdAt",
        mi.updated_at::text as "updatedAt"
      from public.menu_items mi
      join public.unit_types ut on ut.id = mi.unit_type_id
      left join public.menu_categories mc on mc.id = mi.category_id
      where mi.vendor_id = ${vendorId}::uuid
      order by mi.active desc, mc.display_order nulls last, mi.display_order, mi.name
    `.execute(this.database.db);

    return result.rows;
  }

  async findMenuItemById(
    vendorId: string,
    menuItemId: string
  ): Promise<MenuItemRecord | undefined> {
    const result = await sql<MenuItemRecord>`
      select
        mi.id::text as "id",
        mi.vendor_id::text as "vendorId",
        mi.category_id::text as "categoryId",
        mc.name as "categoryName",
        mi.unit_type_id::text as "unitTypeId",
        ut.code as "unitCode",
        mi.name,
        mi.description,
        mi.image_url as "imageUrl",
        mi.price_kobo as "priceKobo",
        ut.counts_toward_spoon_limit as "countsTowardSpoonLimit",
        mi.requires_soup as "requiresSoup",
        mi.active,
        mi.display_order as "displayOrder",
        mi.created_at::text as "createdAt",
        mi.updated_at::text as "updatedAt"
      from public.menu_items mi
      join public.unit_types ut on ut.id = mi.unit_type_id
      left join public.menu_categories mc on mc.id = mi.category_id
      where mi.vendor_id = ${vendorId}::uuid
        and mi.id = ${menuItemId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async upsertMenuItem(
    vendorId: string,
    menuItemId: string | undefined,
    input: UpsertMenuItemInput
  ): Promise<MenuItemRecord | undefined> {
    if (menuItemId === undefined) {
      const inserted = await sql<IdResult>`
        insert into public.menu_items (
          vendor_id,
          category_id,
          unit_type_id,
          name,
          description,
          image_url,
          price_kobo,
          requires_soup,
          display_order
        )
        values (
          ${vendorId}::uuid,
          ${input.categoryId ?? null}::uuid,
          ${input.unitTypeId ?? null}::uuid,
          ${input.name ?? null},
          ${input.description ?? null},
          ${input.imageUrl ?? null},
          ${input.priceKobo ?? null},
          ${input.requiresSoup ?? false},
          ${input.displayOrder ?? 0}
        )
        returning id::text as "id"
      `.execute(this.database.db);

      const id = inserted.rows[0]?.id;
      return id === undefined ? undefined : this.findMenuItemById(vendorId, id);
    }

    const hasCategoryId = Object.hasOwn(input, 'categoryId');
    const hasUnitTypeId = Object.hasOwn(input, 'unitTypeId');
    const hasName = Object.hasOwn(input, 'name');
    const hasDescription = Object.hasOwn(input, 'description');
    const hasImageUrl = Object.hasOwn(input, 'imageUrl');
    const hasPriceKobo = Object.hasOwn(input, 'priceKobo');
    const hasRequiresSoup = Object.hasOwn(input, 'requiresSoup');
    const hasDisplayOrder = Object.hasOwn(input, 'displayOrder');

    const updated = await sql<IdResult>`
      update public.menu_items
      set category_id = case
            when ${hasCategoryId} then ${input.categoryId ?? null}::uuid
            else category_id
          end,
          unit_type_id = case
            when ${hasUnitTypeId} then ${input.unitTypeId ?? null}::uuid
            else unit_type_id
          end,
          name = case
            when ${hasName} then ${input.name ?? null}
            else name
          end,
          description = case
            when ${hasDescription} then ${input.description ?? null}
            else description
          end,
          image_url = case
            when ${hasImageUrl} then ${input.imageUrl ?? null}
            else image_url
          end,
          price_kobo = case
            when ${hasPriceKobo} then ${input.priceKobo ?? null}
            else price_kobo
          end,
          requires_soup = case
            when ${hasRequiresSoup} then ${input.requiresSoup ?? null}
            else requires_soup
          end,
          display_order = case
            when ${hasDisplayOrder} then ${input.displayOrder ?? null}
            else display_order
          end,
          updated_at = now()
      where vendor_id = ${vendorId}::uuid
        and id = ${menuItemId}::uuid
      returning id::text as "id"
    `.execute(this.database.db);

    const id = updated.rows[0]?.id;
    return id === undefined ? undefined : this.findMenuItemById(vendorId, id);
  }

  async setMenuItemActive(
    vendorId: string,
    menuItemId: string,
    active: boolean
  ): Promise<MenuItemRecord | undefined> {
    const result = await sql<IdResult>`
      update public.menu_items
      set active = ${active},
          updated_at = now()
      where vendor_id = ${vendorId}::uuid
        and id = ${menuItemId}::uuid
      returning id::text as "id"
    `.execute(this.database.db);

    const id = result.rows[0]?.id;
    return id === undefined ? undefined : this.findMenuItemById(vendorId, id);
  }

  async findMenuItemOwner(menuItemId: string): Promise<string | undefined> {
    const result = await sql<OwnerResult>`
      select vendor_id::text as "vendorId"
      from public.menu_items
      where id = ${menuItemId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.vendorId;
  }

  async listVendorAvailability(vendorId: string): Promise<VendorAvailabilityEntry[]> {
    const result = await sql<VendorAvailabilityEntry>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        delivery_slot_id::text as "deliverySlotId",
        day_of_week as "dayOfWeek",
        available,
        valid_from::text as "validFrom",
        valid_until::text as "validUntil"
      from public.vendor_slot_availability
      where vendor_id = ${vendorId}::uuid
      order by day_of_week, delivery_slot_id, valid_from nulls first
    `.execute(this.database.db);

    return result.rows;
  }

  async replaceVendorAvailability(
    vendorId: string,
    entries: VendorAvailabilityEntry[]
  ): Promise<VendorAvailabilityEntry[]> {
    await this.database.db.transaction().execute(async (trx) => {
      await sql`
        delete from public.vendor_slot_availability
        where vendor_id = ${vendorId}::uuid
      `.execute(trx);

      for (const entry of entries) {
        await sql`
          insert into public.vendor_slot_availability (
            vendor_id,
            delivery_slot_id,
            day_of_week,
            available,
            valid_from,
            valid_until
          )
          values (
            ${vendorId}::uuid,
            ${entry.deliverySlotId}::uuid,
            ${entry.dayOfWeek},
            ${entry.available},
            ${entry.validFrom ?? null}::date,
            ${entry.validUntil ?? null}::date
          )
        `.execute(trx);
      }
    });

    return this.listVendorAvailability(vendorId);
  }

  async listMenuItemAvailability(menuItemId: string): Promise<MenuItemAvailabilityEntry[]> {
    const result = await sql<MenuItemAvailabilityEntry>`
      select
        id::text as "id",
        menu_item_id::text as "menuItemId",
        delivery_slot_id::text as "deliverySlotId",
        day_of_week as "dayOfWeek",
        available,
        valid_from::text as "validFrom",
        valid_until::text as "validUntil"
      from public.menu_item_slot_availability
      where menu_item_id = ${menuItemId}::uuid
      order by day_of_week, delivery_slot_id, valid_from nulls first
    `.execute(this.database.db);

    return result.rows;
  }

  async replaceMenuItemAvailability(
    menuItemId: string,
    entries: MenuItemAvailabilityEntry[]
  ): Promise<MenuItemAvailabilityEntry[]> {
    await this.database.db.transaction().execute(async (trx) => {
      await sql`
        delete from public.menu_item_slot_availability
        where menu_item_id = ${menuItemId}::uuid
      `.execute(trx);

      for (const entry of entries) {
        await sql`
          insert into public.menu_item_slot_availability (
            menu_item_id,
            delivery_slot_id,
            day_of_week,
            available,
            valid_from,
            valid_until
          )
          values (
            ${menuItemId}::uuid,
            ${entry.deliverySlotId}::uuid,
            ${entry.dayOfWeek},
            ${entry.available},
            ${entry.validFrom ?? null}::date,
            ${entry.validUntil ?? null}::date
          )
        `.execute(trx);
      }
    });

    return this.listMenuItemAvailability(menuItemId);
  }

  async getStoreAvailability(vendorId: string): Promise<StoreAvailabilityState | undefined> {
    const result = await sql<StoreAvailabilityState>`
      select
        accepting_orders as "acceptingOrders",
        state,
        to_char(pause_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "pauseUntil",
        to_char(cutoff_time, 'HH24:MI:SS') as "cutoffTime",
        max_orders_per_day as "maxOrdersPerDay",
        coalesce(
          array(select to_char(d, 'YYYY-MM-DD') from unnest(unavailable_dates) as d order by d),
          '{}'
        ) as "unavailableDates"
      from public.vendor_store_availability
      where vendor_id = ${vendorId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async upsertStoreAvailability(
    vendorId: string,
    state: StoreAvailabilityState
  ): Promise<StoreAvailabilityState> {
    await sql`
      insert into public.vendor_store_availability (
        vendor_id,
        accepting_orders,
        state,
        pause_until,
        max_orders_per_day,
        unavailable_dates
      )
      values (
        ${vendorId}::uuid,
        ${state.acceptingOrders},
        ${state.state},
        ${state.pauseUntil ?? null}::timestamptz,
        ${state.maxOrdersPerDay ?? null}::integer,
        ${state.unavailableDates}::date[]
      )
      on conflict (vendor_id) do update set
        accepting_orders = excluded.accepting_orders,
        state = excluded.state,
        pause_until = excluded.pause_until,
        max_orders_per_day = excluded.max_orders_per_day,
        unavailable_dates = excluded.unavailable_dates
    `.execute(this.database.db);

    // cutoff_time is admin-controlled and untouched here; re-read to return it.
    const persisted = await this.getStoreAvailability(vendorId);
    if (persisted === undefined) {
      throw new Error('Store availability row missing after upsert.');
    }
    return persisted;
  }

  // Materializes inventory rows (quantity 0) for today through today + 7 days
  // for this vendor so newly-available items are immediately stockable instead
  // of waiting for the nightly generate-inventory-horizon cron. generate_menu_item_inventory
  // only inserts missing (item, slot, date) combinations, so it never overwrites
  // vendor-edited quantities.
  async regenerateInventoryHorizon(vendorId: string): Promise<void> {
    await sql`
      select public.generate_menu_item_inventory((current_date + day_offset)::date, ${vendorId}::uuid)
      from generate_series(0, 7) as day_offset
    `.execute(this.database.db);
  }
}
