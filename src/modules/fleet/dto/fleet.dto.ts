import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf
} from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';
import { fleetMemberRoles, fleetPartnerStatuses } from '../fleet.types.js';
import type { FleetMemberRole, FleetPartnerStatus } from '../fleet.types.js';

const riderStatuses = ['deactivated', 'pending', 'suspended', 'verified'] as const;
const phonePattern = /^[+0-9][0-9 ()-]{6,24}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Query-string booleans arrive as text; anything but true/false is left for validation. */
function parseBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** For PATCH fields that may be omitted but never nulled. */
const definedOnly = ValidateIf((_object, value) => value !== undefined);

export class FleetPartnerIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  partnerId!: string;
}

export class FleetPartnerRiderParamDto extends FleetPartnerIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  riderId!: string;
}

export class FleetPartnerBatchParamDto extends FleetPartnerIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  batchId!: string;
}

export class FleetPartnerManagerParamDto extends FleetPartnerIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  userId!: string;
}

export class AdminFleetPartnerListQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  campusId?: string;

  @ApiPropertyOptional({ enum: fleetPartnerStatuses, type: String })
  @IsOptional()
  @IsIn(fleetPartnerStatuses)
  status?: FleetPartnerStatus;
}

export class CreateFleetPartnerDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  campusId!: string;

  @ApiProperty({ maxLength: 120, minLength: 2, type: String, example: 'Swift Logistics' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ type: String, example: '+2348012345678' })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(phonePattern)
  contactPhone?: string;

  @ApiPropertyOptional({ type: String, example: 'ops@swift.example' })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Partner share of its riders delivery earnings in basis points (10000 = 100%).',
    maximum: 10000,
    minimum: 0,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Whether fleet managers may assign batches to their riders.',
    type: Boolean
  })
  @IsOptional()
  @IsBoolean()
  canDispatch?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Auto-dispatch preference (0-100). Higher-priority fleets are offered batches first; platform riders count as 0.',
    maximum: 100,
    minimum: 0,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  dispatchPriority?: number;
}

export class UpdateFleetPartnerDto {
  @ApiPropertyOptional({ maxLength: 120, minLength: 2, type: String })
  @definedOnly
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(phonePattern)
  contactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  contactEmail?: string | null;

  @ApiPropertyOptional({ maximum: 10000, minimum: 0, type: Number })
  @definedOnly
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;

  @ApiPropertyOptional({ type: Boolean })
  @definedOnly
  @IsBoolean()
  canDispatch?: boolean;

  @ApiPropertyOptional({ maximum: 100, minimum: 0, type: Number })
  @definedOnly
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  dispatchPriority?: number;

  @ApiPropertyOptional({
    description:
      'Suspending or deactivating takes the fleet riders off shift and out of auto-dispatch.',
    enum: fleetPartnerStatuses,
    type: String
  })
  @definedOnly
  @IsIn(fleetPartnerStatuses)
  status?: FleetPartnerStatus;
}

export class AddFleetManagerDto {
  @ApiProperty({
    description: 'An unknown email is sent an invite that lands on the fleet dashboard.',
    type: String
  })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ default: 'manager', enum: fleetMemberRoles, type: String })
  @IsOptional()
  @IsIn(fleetMemberRoles)
  role?: FleetMemberRole;
}

export class AttachFleetRiderDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  riderId!: string;
}

export class FleetRiderListQueryDto {
  @ApiPropertyOptional({ enum: riderStatuses, type: String })
  @IsOptional()
  @IsIn(riderStatuses)
  status?: (typeof riderStatuses)[number];

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  available?: boolean;
}

export class FleetBatchListQueryDto {
  @ApiPropertyOptional({
    description: 'Service date (YYYY-MM-DD). Defaults to today.',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    type: String
  })
  @IsOptional()
  @Matches(datePattern)
  date?: string;
}

export class FleetAssignBatchDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  riderId!: string;
}

export class FleetEarningsQueryDto {
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(datePattern)
  dateFrom?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(datePattern)
  dateTo?: string;
}

export class JoinFleetDto {
  @ApiProperty({
    description: 'Join code from the fleet. Case, spaces, and dashes are ignored.',
    type: String,
    example: 'SWFT7K2Q'
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  joinCode!: string;
}
