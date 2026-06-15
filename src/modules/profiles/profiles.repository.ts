import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type {
  AdminMembership,
  CampusMembership,
  CompleteOnboardingInput,
  DefaultLocationInput,
  ProfileRecord,
  ProfilesRepositoryContract,
  ProfileUpdateInput,
  RiderProfile,
  VendorMembership
} from './profiles.types.js';

type ExistsResult = {
  exists: boolean;
};

@Injectable()
export class ProfilesRepository implements ProfilesRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensureProfile(actor: AuthenticatedActor): Promise<ProfileRecord> {
    const result = await sql<ProfileRecord>`
      insert into public.profiles (id, email, last_seen_at)
      values (${actor.userId}::uuid, ${actor.email ?? null}::extensions.citext, now())
      on conflict (id) do update
      set email = coalesce(excluded.email, public.profiles.email),
          last_seen_at = now(),
          updated_at = now()
      returning
        id::text as "id",
        email::text as "email",
        display_name as "displayName",
        phone_number as "phoneNumber",
        avatar_url as "avatarUrl",
        account_status::text as "accountStatus",
        default_campus_id::text as "defaultCampusId",
        default_location_id::text as "defaultLocationId",
        onboarding_completed_at::text as "onboardingCompletedAt",
        last_seen_at::text as "lastSeenAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const profile = result.rows[0];
    if (profile === undefined) {
      throw new Error('Profile upsert did not return a profile row.');
    }
    return profile;
  }

  async findCampusMemberships(userId: string): Promise<CampusMembership[]> {
    const result = await sql<CampusMembership>`
      select
        cm.id::text as "id",
        c.id::text as "campusId",
        c.name as "campusName",
        c.slug as "campusSlug",
        c.timezone as "timezone",
        c.currency as "currency",
        c.country_code as "countryCode",
        cm.active as "active",
        cm.joined_at::text as "joinedAt"
      from public.campus_memberships cm
      join public.campuses c on c.id = cm.campus_id
      where cm.user_id = ${userId}::uuid
        and cm.active
        and c.active
      order by c.name
    `.execute(this.database.db);

    return result.rows;
  }

  async findAdminMemberships(userId: string): Promise<AdminMembership[]> {
    const result = await sql<AdminMembership>`
      select
        am.id::text as "id",
        am.campus_id::text as "campusId",
        c.name as "campusName",
        am.role::text as "role",
        am.active as "active",
        am.granted_at::text as "grantedAt"
      from public.admin_memberships am
      left join public.campuses c on c.id = am.campus_id
      where am.user_id = ${userId}::uuid
        and am.active
        and am.revoked_at is null
        and (am.campus_id is null or c.active)
      order by am.role desc, c.name nulls first
    `.execute(this.database.db);

    return result.rows;
  }

  async findVendorMemberships(userId: string): Promise<VendorMembership[]> {
    const result = await sql<VendorMembership>`
      select
        vu.id::text as "id",
        v.id::text as "vendorId",
        v.campus_id::text as "campusId",
        v.display_name as "vendorDisplayName",
        v.slug as "vendorSlug",
        vu.role::text as "role",
        vu.active as "active"
      from public.vendor_users vu
      join public.vendors v on v.id = vu.vendor_id
      join public.campuses c on c.id = v.campus_id
      where vu.user_id = ${userId}::uuid
        and vu.active
        and v.active
        and c.active
      order by v.display_name
    `.execute(this.database.db);

    return result.rows;
  }

  async findRiderProfiles(userId: string): Promise<RiderProfile[]> {
    const result = await sql<RiderProfile>`
      select
        r.id::text as "id",
        r.campus_id::text as "campusId",
        r.display_name as "displayName",
        r.phone as "phone",
        r.status::text as "status",
        r.active as "active"
      from public.riders r
      join public.campuses c on c.id = r.campus_id
      where r.user_id = ${userId}::uuid
        and r.active
        and c.active
      order by r.display_name
    `.execute(this.database.db);

    return result.rows;
  }

  async isActiveCampusMember(userId: string, campusId: string): Promise<boolean> {
    const result = await sql<ExistsResult>`
      select exists (
        select 1
        from public.campus_memberships cm
        join public.campuses c on c.id = cm.campus_id
        where cm.user_id = ${userId}::uuid
          and cm.campus_id = ${campusId}::uuid
          and cm.active
          and c.active
      ) as "exists"
    `.execute(this.database.db);

    return result.rows[0]?.exists ?? false;
  }

  async isActiveCampusLocation(campusId: string, locationId: string): Promise<boolean> {
    const result = await sql<ExistsResult>`
      select exists (
        select 1
        from public.campus_locations cl
        join public.campuses c on c.id = cl.campus_id
        where cl.id = ${locationId}::uuid
          and cl.campus_id = ${campusId}::uuid
          and cl.active
          and c.active
      ) as "exists"
    `.execute(this.database.db);

    return result.rows[0]?.exists ?? false;
  }

  async updateProfile(
    userId: string,
    input: ProfileUpdateInput
  ): Promise<ProfileRecord | undefined> {
    const hasDisplayName = Object.hasOwn(input, 'displayName');
    const hasPhoneNumber = Object.hasOwn(input, 'phoneNumber');
    const hasAvatarUrl = Object.hasOwn(input, 'avatarUrl');

    const result = await sql<ProfileRecord>`
      update public.profiles
      set display_name = case
            when ${hasDisplayName} then ${input.displayName ?? null}
            else display_name
          end,
          phone_number = case
            when ${hasPhoneNumber} then ${input.phoneNumber ?? null}
            else phone_number
          end,
          avatar_url = case
            when ${hasAvatarUrl} then ${input.avatarUrl ?? null}
            else avatar_url
          end,
          updated_at = now()
      where id = ${userId}::uuid
      returning
        id::text as "id",
        email::text as "email",
        display_name as "displayName",
        phone_number as "phoneNumber",
        avatar_url as "avatarUrl",
        account_status::text as "accountStatus",
        default_campus_id::text as "defaultCampusId",
        default_location_id::text as "defaultLocationId",
        onboarding_completed_at::text as "onboardingCompletedAt",
        last_seen_at::text as "lastSeenAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async completeOnboarding(
    userId: string,
    input: CompleteOnboardingInput
  ): Promise<ProfileRecord | undefined> {
    const result = await sql<ProfileRecord>`
      update public.profiles
      set phone_number = ${input.phoneNumber},
          default_campus_id = ${input.defaultCampusId}::uuid,
          default_location_id = ${input.defaultLocationId}::uuid,
          onboarding_completed_at = coalesce(onboarding_completed_at, now()),
          updated_at = now()
      where id = ${userId}::uuid
      returning
        id::text as "id",
        email::text as "email",
        display_name as "displayName",
        phone_number as "phoneNumber",
        avatar_url as "avatarUrl",
        account_status::text as "accountStatus",
        default_campus_id::text as "defaultCampusId",
        default_location_id::text as "defaultLocationId",
        onboarding_completed_at::text as "onboardingCompletedAt",
        last_seen_at::text as "lastSeenAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async setDefaultLocation(
    userId: string,
    input: DefaultLocationInput
  ): Promise<ProfileRecord | undefined> {
    const result = await sql<ProfileRecord>`
      update public.profiles
      set default_campus_id = ${input.campusId}::uuid,
          default_location_id = ${input.locationId}::uuid,
          updated_at = now()
      where id = ${userId}::uuid
      returning
        id::text as "id",
        email::text as "email",
        display_name as "displayName",
        phone_number as "phoneNumber",
        avatar_url as "avatarUrl",
        account_status::text as "accountStatus",
        default_campus_id::text as "defaultCampusId",
        default_location_id::text as "defaultLocationId",
        onboarding_completed_at::text as "onboardingCompletedAt",
        last_seen_at::text as "lastSeenAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }
}
