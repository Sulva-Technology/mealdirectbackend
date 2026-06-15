import type { AuthenticatedActor } from '../auth/actor-context.js';

export type LocationType = 'department' | 'hostel';

export type CampusRecord = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  countryCode: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CampusZoneRecord = {
  id: string;
  campusId: string;
  name: string;
  code: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CampusLocationRecord = {
  id: string;
  campusId: string;
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  name: string;
  slug: string;
  type: LocationType;
  deliveryInstructions: string | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DeliverySlotRecord = {
  id: string;
  campusId: string;
  name: string;
  deliveryTime: string;
  cutoffMinutes: number;
  active: boolean;
  displayOrder: number;
  orderingCutoffAt: string | null;
  acceptingOrders: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCampusInput = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  countryCode: string;
  active: boolean;
};

export type UpdateCampusInput = Partial<CreateCampusInput>;

export type CreateZoneInput = {
  name: string;
  code: string;
  active: boolean;
  displayOrder: number;
};

export type UpdateZoneInput = Partial<CreateZoneInput>;

export type CreateLocationInput = {
  zoneId: string;
  name: string;
  slug: string;
  type: LocationType;
  deliveryInstructions: string | null;
  active: boolean;
  displayOrder: number;
};

export type UpdateLocationInput = Partial<CreateLocationInput>;

export type CreateDeliverySlotInput = {
  name: string;
  deliveryTime: string;
  cutoffMinutes: number;
  active: boolean;
  displayOrder: number;
};

export type UpdateDeliverySlotInput = Partial<CreateDeliverySlotInput>;

export type CampusDirectoryRepositoryContract = {
  listPublicCampuses: () => Promise<CampusRecord[]>;
  listAdminCampuses: (campusId?: string) => Promise<CampusRecord[]>;
  createCampus: (input: CreateCampusInput) => Promise<CampusRecord>;
  updateCampus: (campusId: string, input: UpdateCampusInput) => Promise<CampusRecord | undefined>;
  listPublicLocations: (campusId: string) => Promise<CampusLocationRecord[]>;
  listAdminLocations: (campusId: string) => Promise<CampusLocationRecord[]>;
  createLocation: (
    campusId: string,
    input: CreateLocationInput
  ) => Promise<CampusLocationRecord | undefined>;
  updateLocation: (
    locationId: string,
    input: UpdateLocationInput,
    scopedCampusId?: string
  ) => Promise<CampusLocationRecord | undefined>;
  listPublicDeliverySlots: (
    campusId: string,
    serviceDate?: string
  ) => Promise<DeliverySlotRecord[]>;
  listAdminDeliverySlots: (campusId: string) => Promise<DeliverySlotRecord[]>;
  createDeliverySlot: (
    campusId: string,
    input: CreateDeliverySlotInput
  ) => Promise<DeliverySlotRecord | undefined>;
  updateDeliverySlot: (
    slotId: string,
    input: UpdateDeliverySlotInput,
    scopedCampusId?: string
  ) => Promise<DeliverySlotRecord | undefined>;
  listAdminZones: (campusId: string) => Promise<CampusZoneRecord[]>;
  createZone: (campusId: string, input: CreateZoneInput) => Promise<CampusZoneRecord | undefined>;
  updateZone: (
    zoneId: string,
    input: UpdateZoneInput,
    scopedCampusId?: string
  ) => Promise<CampusZoneRecord | undefined>;
};

export type AdminActor = Extract<AuthenticatedActor, { role: 'campus_admin' | 'super_admin' }>;
