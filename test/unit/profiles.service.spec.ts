import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { CompleteOnboardingDto } from '../../src/modules/profiles/dto/profile.dto.js';
import { ProfilesService } from '../../src/modules/profiles/profiles.service.js';
import type {
  AdminMembership,
  CampusMembership,
  ProfileRecord,
  ProfilesRepositoryContract,
  RiderProfile,
  VendorMembership
} from '../../src/modules/profiles/profiles.types.js';

const actor: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'student@example.com',
  role: 'customer'
};

const profile: ProfileRecord = {
  id: actor.userId,
  email: 'student@example.com',
  displayName: 'Ada Student',
  phoneNumber: '+2348012345678',
  avatarUrl: null,
  accountStatus: 'active',
  defaultCampusId: '22222222-2222-4222-8222-222222222222',
  defaultLocationId: '33333333-3333-4333-8333-333333333333',
  onboardingCompletedAt: null,
  lastSeenAt: '2026-06-15T08:00:00.000Z',
  createdAt: '2026-06-15T07:00:00.000Z',
  updatedAt: '2026-06-15T08:00:00.000Z'
};

const campusMembership: CampusMembership = {
  id: '44444444-4444-4444-8444-444444444444',
  campusId: profile.defaultCampusId ?? '',
  campusName: 'Venite University',
  campusSlug: 'venite-university',
  timezone: 'Africa/Lagos',
  currency: 'NGN',
  countryCode: 'NG',
  active: true,
  joinedAt: '2026-06-15T07:30:00.000Z'
};

const vendorMembership: VendorMembership = {
  id: '55555555-5555-4555-8555-555555555555',
  vendorId: '66666666-6666-4666-8666-666666666666',
  campusId: campusMembership.campusId,
  vendorDisplayName: 'Ada Kitchen',
  vendorSlug: 'ada-kitchen',
  role: 'owner',
  active: true
};

const riderProfile: RiderProfile = {
  id: '77777777-7777-4777-8777-777777777777',
  campusId: campusMembership.campusId,
  displayName: 'Ada Rider',
  phone: '+2348012345678',
  status: 'verified',
  active: true
};

const adminMembership: AdminMembership = {
  id: '88888888-8888-4888-8888-888888888888',
  campusId: campusMembership.campusId,
  campusName: 'Venite University',
  role: 'campus_admin',
  active: true,
  grantedAt: '2026-06-15T07:45:00.000Z'
};

function createRepository(): ProfilesRepositoryContract {
  return {
    ensureProfile: vi.fn().mockResolvedValue(profile),
    findCampusMemberships: vi.fn().mockResolvedValue([campusMembership]),
    findVendorMemberships: vi.fn().mockResolvedValue([vendorMembership]),
    findRiderProfiles: vi.fn().mockResolvedValue([riderProfile]),
    findAdminMemberships: vi.fn().mockResolvedValue([adminMembership]),
    isActiveCampusMember: vi.fn().mockResolvedValue(true),
    isActiveCampusLocation: vi.fn().mockResolvedValue(true),
    updateProfile: vi.fn().mockResolvedValue({ ...profile, displayName: 'Ada' }),
    completeOnboarding: vi.fn().mockResolvedValue({
      ...profile,
      onboardingCompletedAt: '2026-06-15T08:10:00.000Z'
    }),
    setDefaultLocation: vi.fn().mockResolvedValue(profile)
  };
}

describe('ProfilesService', () => {
  let repository: ProfilesRepositoryContract;
  let service: ProfilesService;

  beforeEach(() => {
    repository = createRepository();
    service = new ProfilesService(repository);
  });

  it('returns a role-aware current-user session from profile memberships', async () => {
    await expect(service.getCurrentUser(actor)).resolves.toEqual({
      actor,
      profile: { ...profile, onboardingCompleted: false },
      roles: ['customer', 'vendor', 'rider', 'campus_admin'],
      campuses: [campusMembership],
      vendorMemberships: [vendorMembership],
      riderProfiles: [riderProfile],
      adminMemberships: [adminMembership]
    });
  });

  it('normalizes editable profile fields before persisting them', async () => {
    await service.updateProfile(actor, {
      avatarUrl: null,
      displayName: ' Ada ',
      phoneNumber: ' +2348012345678 '
    });

    expect(repository.updateProfile).toHaveBeenCalledWith(actor.userId, {
      avatarUrl: null,
      displayName: 'Ada',
      phoneNumber: '+2348012345678'
    });
  });

  it('requires campus membership before completing onboarding', async () => {
    vi.mocked(repository.isActiveCampusMember).mockResolvedValue(false);
    const input: CompleteOnboardingDto = {
      defaultCampusId: campusMembership.campusId,
      defaultLocationId: profile.defaultLocationId ?? '',
      phoneNumber: '+2348012345678'
    };

    await expect(service.completeOnboarding(actor, input)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(repository.completeOnboarding).not.toHaveBeenCalled();
  });

  it('rejects default locations outside the selected active campus', async () => {
    vi.mocked(repository.isActiveCampusLocation).mockResolvedValue(false);

    await expect(
      service.setDefaultLocation(actor, {
        campusId: campusMembership.campusId,
        locationId: profile.defaultLocationId ?? ''
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.setDefaultLocation).not.toHaveBeenCalled();
  });

  it('maps missing profile rows to not found errors', async () => {
    vi.mocked(repository.updateProfile).mockResolvedValue(undefined);

    await expect(service.updateProfile(actor, { displayName: 'Ada' })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
