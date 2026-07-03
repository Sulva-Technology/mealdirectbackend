import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { ActorRole } from '../../domain/authorization.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { MediaService } from '../storage/media.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { SignedUploadTarget } from '../storage/storage.service.js';
import { MaxAvatarBytes, StorageBuckets } from '../storage/storage.constants.js';
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
    @Inject(ProfilesRepository) private readonly repository: ProfilesRepositoryContract,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  // Avatars live in a private bucket; sign the stored key into a short-lived read
  // URL before the profile leaves the service.
  private async signProfile(response: ProfileResponse): Promise<ProfileResponse> {
    return {
      ...response,
      avatarUrl: (await this.storage.signKey(StorageBuckets.avatars, response.avatarUrl)) ?? null
    };
  }

  async ensureProfile(actor: AuthenticatedActor): Promise<ProfileRecord> {
    return this.repository.ensureProfile(actor);
  }

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
      profile: await this.signProfile(toProfileResponse(profile)),
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

    return this.signProfile(toProfileResponse(profile));
  }

  async issueAvatarUpload(
    actor: AuthenticatedActor,
    input: { contentType: string; sizeBytes: number }
  ): Promise<SignedUploadTarget> {
    await this.repository.ensureProfile(actor);
    return this.media.issueUpload({
      bucket: StorageBuckets.avatars,
      ownerPrefix: actor.userId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      maxBytes: MaxAvatarBytes
    });
  }

  async confirmAvatar(actor: AuthenticatedActor, key: string): Promise<ProfileResponse> {
    const before = await this.repository.ensureProfile(actor);
    await this.media.confirmUpload({
      bucket: StorageBuckets.avatars,
      key,
      ownerPrefix: actor.userId,
      maxBytes: MaxAvatarBytes
    });

    const previousKey = before.avatarUrl ?? null;

    const profile = await this.repository.updateProfile(actor.userId, { avatarUrl: key });
    if (profile === undefined) {
      throw missingProfile();
    }
    if (previousKey !== null && previousKey !== key) {
      await this.media.removeIfKey(StorageBuckets.avatars, previousKey);
    }
    return this.signProfile(toProfileResponse(profile));
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

    return this.signProfile(toProfileResponse(profile));
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

    return this.signProfile(toProfileResponse(profile));
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
