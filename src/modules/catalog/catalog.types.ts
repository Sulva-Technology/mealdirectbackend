export type DeliveryMode = 'meal_direct_rider' | 'vendor_delivery';

export type CatalogSoupOption = {
  id: string;
  name: string;
};

export type CatalogVendor = {
  id: string;
  campusId: string;
  displayName: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  kitchenLocation: string | null;
  defaultDeliveryMode: DeliveryMode;
  // Active soups this vendor offers; the client renders these as the picker for any
  // menu item flagged requiresSoup.
  soupOptions: CatalogSoupOption[];
};

export type MenuItem = {
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
  remainingQuantity: number | null;
  countsTowardSpoonLimit: boolean;
  requiresSoup: boolean;
};

export type VendorListFilters = {
  campusId: string;
  date?: string;
  slotId?: string;
  locationId?: string;
};

export type MenuFilters = {
  date?: string;
  slotId?: string;
};

export type CatalogRepositoryContract = {
  listVendors: (filters: VendorListFilters) => Promise<CatalogVendor[]>;
  findVendorById: (vendorId: string) => Promise<CatalogVendor | undefined>;
  listMenuItems: (vendorId: string, filters: MenuFilters) => Promise<MenuItem[]>;
};
