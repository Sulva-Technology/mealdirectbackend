import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { ActorRole } from '../../domain/authorization.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type {
  CampusMembership,
  CompleteOnboardingInput,
  DefaultLocationInput,
  MeSession,
  ProfileRecord,
  ProfileResponse,
  ProfilesRepositoryContract,
  ProfileUpdateInput
} from './profiles.types.js';
import { ProfilesRepository } from './profiles.repository.js';

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toProfileResponse(profile: ProfileRecord): ProfileResponse {
  return {
    ...profile,
    onboardingCompleted: profile.onboardingCompletedAt !== null
  };
}

function pushRole(roles: ActorRole[], role: ActorRole): void {
  if (!roles.includes(role)) {
    roles.push(role);
  }
}

function missingProfile(): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Profile was not found.'
  });
}

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(ProfilesRepository) private readonly repository: ProfilesRepositoryContract
  ) {}

  async getCurrentUser(actor: AuthenticatedActor): Promise<MeSession> {
    const profile = await this.repository.ensureProfile(actor);
    const [campuses, vendorMemberships, riderProfiles, adminMemberships] = await Promise.all([
      this.repository.findCampusMemberships(actor.userId),
      this.repository.findVendorMemberships(actor.userId),
      this.repository.findRiderProfiles(actor.userId),
      this.repository.findAdminMemberships(actor.userId)
    ]);

    const roles: ActorRole[] = ['customer'];
    if (vendorMemberships.length > 0) pushRole(roles, 'vendor');
    if (riderProfiles.length > 0) pushRole(roles, 'rider');
    if (adminMemberships.some((membership) => membership.role === 'campus_admin')) {
      pushRole(roles, 'campus_admin');
    }
    if (adminMemberships.some((membership) => membership.role === 'super_admin')) {
      pushRole(roles, 'super_admin');
    }

    return {
      actor,
      profile: toProfileResponse(profile),
      roles,
      campuses,
      vendorMemberships,
      riderProfiles,
      adminMemberships
    };
  }

  async listCampuses(actor: AuthenticatedActor): Promise<CampusMembership[]> {
    await this.repository.ensureProfile(actor);
    return this.repository.findCampusMemberships(actor.userId);
  }

  async updateProfile(
    actor: AuthenticatedActor,
    input: ProfileUpdateInput
  ): Promise<ProfileResponse> {
    await this.repository.ensureProfile(actor);

    const update: ProfileUpdateInput = {};
    const displayName = normalizeNullableString(input.displayName);
    const phoneNumber = normalizeNullableString(input.phoneNumber);
    const avatarUrl = normalizeNullableString(input.avatarUrl);

    if (displayName !== undefined) update.displayName = displayName;
    if (phoneNumber !== undefined) update.phoneNumber = phoneNumber;
    if (avatarUrl !== undefined) update.avatarUrl = avatarUrl;

    const profile = await this.repository.updateProfile(actor.userId, update);
    if (profile === undefined) {
      throw missingProfile();
    }

    return toProfileResponse(profile);
  }

  async completeOnboarding(
    actor: AuthenticatedActor,
    input: CompleteOnboardingInput
  ): Promise<ProfileResponse> {
    await this.repository.ensureProfile(actor);
    await this.assertActiveLocation(input.defaultCampusId, input.defaultLocationId);
    await this.repository.joinCampus(actor.userId, input.defaultCampusId);

    const profile = await this.repository.completeOnboarding(actor.userId, {
      ...input,
      phoneNumber: input.phoneNumber.trim()
    });
    if (profile === undefined) {
      throw missingProfile();
    }

    return toProfileResponse(profile);
  }

  async setDefaultLocation(
    actor: AuthenticatedActor,
    input: DefaultLocationInput
  ): Promise<ProfileResponse> {
    await this.repository.ensureProfile(actor);
    await this.assertActiveLocation(input.campusId, input.locationId);
    await this.repository.joinCampus(actor.userId, input.campusId);

    const profile = await this.repository.setDefaultLocation(actor.userId, input);
    if (profile === undefined) {
      throw missingProfile();
    }

    return toProfileResponse(profile);
  }

  private async assertActiveLocation(campusId: string, locationId: string): Promise<void> {
    if (!(await this.repository.isActiveCampusLocation(campusId, locationId))) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Default location must belong to the selected active campus.'
      });
    }
  }
}
