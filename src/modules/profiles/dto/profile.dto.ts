import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { actorRoles } from '../../../domain/authorization.js';

const phonePattern = /^[+0-9][0-9 ()-]{6,24}$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Display name shown in Meal Direct operational surfaces.',
    maxLength: 120,
    minLength: 1,
    nullable: true,
    type: String
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string | null;

  @ApiPropertyOptional({
    description: 'Nigerian or international phone number for delivery coordination.',
    example: '+2348012345678',
    nullable: true,
    type: String
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(phonePattern)
  phoneNumber?: string | null;

  @ApiPropertyOptional({
    description: 'Profile image URL mirrored from the identity provider or user settings.',
    nullable: true,
    type: String
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsUrl({ require_tld: false })
  avatarUrl?: string | null;
}

export class CompleteOnboardingDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  defaultCampusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  defaultLocationId!: string;

  @ApiProperty({ example: '+2348012345678', type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(phonePattern)
  phoneNumber!: string;
}

export class DefaultLocationDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  locationId!: string;
}

export class ProfileRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  phoneNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl!: string | null;

  @ApiProperty({ enum: ['active', 'suspended', 'deactivated'], type: String })
  accountStatus!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  defaultCampusId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  defaultLocationId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  onboardingCompletedAt!: string | null;

  @ApiProperty({ type: Boolean })
  onboardingCompleted!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastSeenAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class CampusMembershipDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  campusName!: string;

  @ApiProperty({ type: String })
  campusSlug!: string;

  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  countryCode!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: String })
  joinedAt!: string;
}

export class AdminMembershipDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  campusId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  campusName!: string | null;

  @ApiProperty({ enum: ['campus_admin', 'super_admin'], type: String })
  role!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: String })
  grantedAt!: string;
}

export class VendorMembershipDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  vendorDisplayName!: string;

  @ApiProperty({ type: String })
  vendorSlug!: string;

  @ApiProperty({ enum: ['owner', 'staff'], type: String })
  role!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;
}

export class RiderProfileDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  phone!: string;

  @ApiProperty({ enum: ['pending', 'verified', 'suspended', 'deactivated'], type: String })
  status!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;
}

export class MeActorDto {
  @ApiProperty({ format: 'uuid', type: String })
  userId!: string;

  @ApiProperty({ enum: actorRoles, type: String })
  role!: string;

  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  campusId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  vendorId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  riderId?: string;
}

export class MeSessionDto {
  @ApiProperty({ type: () => MeActorDto })
  actor!: MeActorDto;

  @ApiProperty({ type: () => ProfileRecordDto })
  profile!: ProfileRecordDto;

  @ApiProperty({ enum: actorRoles, isArray: true, type: String })
  roles!: string[];

  @ApiProperty({ isArray: true, type: () => CampusMembershipDto })
  campuses!: CampusMembershipDto[];

  @ApiProperty({ isArray: true, type: () => VendorMembershipDto })
  vendorMemberships!: VendorMembershipDto[];

  @ApiProperty({ isArray: true, type: () => RiderProfileDto })
  riderProfiles!: RiderProfileDto[];

  @ApiProperty({ isArray: true, type: () => AdminMembershipDto })
  adminMemberships!: AdminMembershipDto[];
}

export class MeSessionEnvelopeDto {
  @ApiProperty({ type: () => MeSessionDto })
  data!: MeSessionDto;
}

export class ProfileEnvelopeDto {
  @ApiProperty({ type: () => ProfileRecordDto })
  data!: ProfileRecordDto;
}

export class CampusMembershipListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => CampusMembershipDto })
  data!: CampusMembershipDto[];
}
