import type { ActorRole } from '../../domain/authorization.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';
export type AdminMembershipRole = 'campus_admin' | 'super_admin';
export type VendorUserRole = 'owner' | 'staff';
export type RiderStatus = 'pending' | 'verified' | 'suspended' | 'deactivated';

export type ProfileRecord = {
  id: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  avatarUrl: string | null;
  accountStatus: AccountStatus;
  defaultCampusId: string | null;
  defaultLocationId: string | null;
  onboardingCompletedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileResponse = ProfileRecord & {
  onboardingCompleted: boolean;
};

export type CampusMembership = {
  id: string;
  campusId: string;
  campusName: string;
  campusSlug: string;
  timezone: string;
  currency: string;
  countryCode: string;
  active: boolean;
  joinedAt: string;
};

export type AdminMembership = {
  id: string;
  campusId: string | null;
  campusName: string | null;
  role: AdminMembershipRole;
  active: boolean;
  grantedAt: string;
};

export type VendorMembership = {
  id: string;
  vendorId: string;
  campusId: string;
  vendorDisplayName: string;
  vendorSlug: string;
  role: VendorUserRole;
  active: boolean;
};

export type RiderProfile = {
  id: string;
  campusId: string;
  displayName: string;
  phone: string;
  status: RiderStatus;
  active: boolean;
};

export type MeSession = {
  actor: AuthenticatedActor;
  profile: ProfileResponse;
  roles: ActorRole[];
  campuses: CampusMembership[];
  vendorMemberships: VendorMembership[];
  riderProfiles: RiderProfile[];
  adminMemberships: AdminMembership[];
};

export type ProfileUpdateInput = {
  displayName?: string | null;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
};

export type CompleteOnboardingInput = {
  defaultCampusId: string;
  defaultLocationId: string;
  phoneNumber: string;
};

export type DefaultLocationInput = {
  campusId: string;
  locationId: string;
};

export type ProfilesRepositoryContract = {
  ensureProfile: (actor: AuthenticatedActor) => Promise<ProfileRecord>;
  findCampusMemberships: (userId: string) => Promise<CampusMembership[]>;
  findAdminMemberships: (userId: string) => Promise<AdminMembership[]>;
  findVendorMemberships: (userId: string) => Promise<VendorMembership[]>;
  findRiderProfiles: (userId: string) => Promise<RiderProfile[]>;
  isActiveCampusMember: (userId: string, campusId: string) => Promise<boolean>;
  isActiveCampusLocation: (campusId: string, locationId: string) => Promise<boolean>;
  joinCampus: (userId: string, campusId: string) => Promise<void>;
  updateProfile: (userId: string, input: ProfileUpdateInput) => Promise<ProfileRecord | undefined>;
  completeOnboarding: (
    userId: string,
    input: CompleteOnboardingInput
  ) => Promise<ProfileRecord | undefined>;
  setDefaultLocation: (
    userId: string,
    input: DefaultLocationInput
  ) => Promise<ProfileRecord | undefined>;
};
