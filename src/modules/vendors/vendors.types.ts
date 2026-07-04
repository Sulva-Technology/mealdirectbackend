export type DeliveryMode = 'meal_direct_rider' | 'vendor_delivery';
export type VendorStatus = 'approved' | 'deactivated' | 'pending' | 'suspended';

export type VendorProfile = {
  id: string;
  campusId: string;
  legalName: string;
  displayName: string;
  slug: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  kitchenLocation: string | null;
  serviceFeeKobo: number | null;
  status: VendorStatus;
  active: boolean;
  defaultDeliveryMode: DeliveryMode;
  createdAt: string;
  updatedAt: string;
};

export type VendorOnboardInput = {
  campusId: string;
  legalName: string;
  displayName: string;
  phone?: string;
};

export type VendorOnboardRepositoryInput = VendorOnboardInput & {
  slug: string;
  userId: string;
  autoApprove: boolean;
};

export type VendorProfileUpdateInput = {
  displayName?: string;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  kitchenLocation?: string | null;
  serviceFeeKobo?: number | null;
  defaultDeliveryMode?: DeliveryMode;
};

export type VendorPayoutAccount = {
  id: string;
  vendorId: string;
  paystackRecipientCode: string | null;
  bankName: string;
  bankCode: string | null;
  maskedAccountNumber: string;
  accountName: string;
  verifiedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VendorPayoutAccountInput = {
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountNumber: string;
  paystackRecipientCode?: string;
};

export type VendorPayoutAccountRecordInput = Omit<VendorPayoutAccountInput, 'accountNumber'> & {
  maskedAccountNumber: string;
};

export type MenuCategoryRecord = {
  id: string;
  vendorId: string;
  name: string;
  slug: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type UnitTypeRecord = {
  id: string;
  code: string;
  displayName: string;
  countsTowardSpoonLimit: boolean;
  active: boolean;
};

export type CreateUnitTypeInput = {
  code: string;
  displayName: string;
  countsTowardSpoonLimit?: boolean;
};

export type UpdateUnitTypeInput = {
  displayName?: string;
  countsTowardSpoonLimit?: boolean;
  active?: boolean;
};

export type CreateMenuCategoryInput = {
  name: string;
  displayOrder?: number;
};

export type MenuMetadata = {
  categories: MenuCategoryRecord[];
  unitTypes: UnitTypeRecord[];
};

export type MenuItemRecord = {
  id: string;
  vendorId: string;
  categoryId: string | null;
  categoryName: string | null;
  unitTypeId: string;
  unitCode: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceKobo: number;
  countsTowardSpoonLimit: boolean;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMenuItemInput = {
  categoryId?: string | null;
  unitTypeId?: string;
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  priceKobo?: number;
  displayOrder?: number;
};

export type UpsertMenuCategoryInput = {
  name: string;
  slug: string;
  active?: boolean;
  displayOrder?: number;
};

export type VendorAvailabilityEntry = {
  id?: string;
  vendorId?: string;
  deliverySlotId: string;
  dayOfWeek: number;
  available: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
};

export type MenuItemAvailabilityEntry = {
  id?: string;
  menuItemId?: string;
  deliverySlotId: string;
  dayOfWeek: number;
  available: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
};

export type AvailabilityUpdateInput = {
  entries: VendorAvailabilityEntry[];
};

export type MenuItemScheduleUpdateInput = {
  entries: MenuItemAvailabilityEntry[];
};

export type VendorsRepositoryContract = {
  assertVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  findVendorIdForUser: (userId: string) => Promise<string | undefined>;
  onboardVendor: (input: VendorOnboardRepositoryInput) => Promise<VendorProfile>;
  findVendorProfile: (vendorId: string) => Promise<VendorProfile | undefined>;
  findCampusMaxServiceFeeKobo: (vendorId: string) => Promise<number | undefined>;
  updateVendorProfile: (
    vendorId: string,
    input: VendorProfileUpdateInput
  ) => Promise<VendorProfile | undefined>;
  findActivePayoutAccount: (vendorId: string) => Promise<VendorPayoutAccount | undefined>;
  upsertPayoutAccount: (
    vendorId: string,
    input: VendorPayoutAccountRecordInput
  ) => Promise<VendorPayoutAccount>;
  listMenuCategories: (vendorId: string) => Promise<MenuCategoryRecord[]>;
  upsertMenuCategory: (
    vendorId: string,
    input: UpsertMenuCategoryInput
  ) => Promise<MenuCategoryRecord>;
  findMenuCategoryOwner: (categoryId: string) => Promise<string | undefined>;
  listUnitTypes: () => Promise<UnitTypeRecord[]>;
  listAllUnitTypes: () => Promise<UnitTypeRecord[]>;
  createUnitType: (input: CreateUnitTypeInput) => Promise<UnitTypeRecord>;
  updateUnitType: (
    id: string,
    input: UpdateUnitTypeInput
  ) => Promise<UnitTypeRecord | undefined>;
  listMenuItems: (vendorId: string) => Promise<MenuItemRecord[]>;
  findMenuItemById: (vendorId: string, menuItemId: string) => Promise<MenuItemRecord | undefined>;
  upsertMenuItem: (
    vendorId: string,
    menuItemId: string | undefined,
    input: UpsertMenuItemInput
  ) => Promise<MenuItemRecord | undefined>;
  setMenuItemActive: (
    vendorId: string,
    menuItemId: string,
    active: boolean
  ) => Promise<MenuItemRecord | undefined>;
  findMenuItemOwner: (menuItemId: string) => Promise<string | undefined>;
  listVendorAvailability: (vendorId: string) => Promise<VendorAvailabilityEntry[]>;
  replaceVendorAvailability: (
    vendorId: string,
    entries: VendorAvailabilityEntry[]
  ) => Promise<VendorAvailabilityEntry[]>;
  listMenuItemAvailability: (menuItemId: string) => Promise<MenuItemAvailabilityEntry[]>;
  replaceMenuItemAvailability: (
    menuItemId: string,
    entries: MenuItemAvailabilityEntry[]
  ) => Promise<MenuItemAvailabilityEntry[]>;
  regenerateInventoryHorizon: (vendorId: string) => Promise<void>;
};
