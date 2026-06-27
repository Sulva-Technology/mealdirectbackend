import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const zoneCodePattern = /^[A-Z0-9_]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CampusIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  campusId!: string;
}

export class ZoneIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  zoneId!: string;
}

export class LocationIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  locationId!: string;
}

export class DeliverySlotIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  slotId!: string;
}

export class DeliverySlotsQueryDto {
  @ApiPropertyOptional({
    description: 'Service date used to calculate ordering cutoffs.',
    example: '2026-06-15',
    type: String
  })
  @IsOptional()
  @Matches(datePattern)
  date?: string;
}

export class CreateCampusDto {
  @ApiProperty({ maxLength: 160, minLength: 1, type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ pattern: slugPattern.source, type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(slugPattern)
  slug!: string;

  @ApiProperty({ default: 'Africa/Lagos', type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  timezone!: string;

  @ApiProperty({ default: 'NGN', pattern: '^[A-Z]{3}$', type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ApiProperty({ default: 'NG', pattern: '^[A-Z]{2}$', type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty({ default: true, type: Boolean })
  @IsBoolean()
  active!: boolean;
}

export class UpdateCampusDto {
  @ApiPropertyOptional({ maxLength: 160, minLength: 1, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ pattern: slugPattern.source, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(slugPattern)
  slug?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  timezone?: string;

  @ApiPropertyOptional({ pattern: '^[A-Z]{3}$', type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ pattern: '^[A-Z]{2}$', type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional({
    minimum: 0,
    type: Number,
    description: 'Ceiling (kobo) a vendor on this campus may set for its takeaway/packaging fee.'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxServiceFeeKobo?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateZoneDto {
  @ApiProperty({ type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ pattern: zoneCodePattern.source, type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(zoneCodePattern)
  code!: string;

  @ApiProperty({ default: true, type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ default: 0, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder!: number;

  @ApiPropertyOptional({
    minimum: 7500,
    type: Number,
    description: 'Customer-facing delivery fee in kobo for this zone (defaults to ₦150). The ₦75 rider share is fixed.'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7500)
  deliveryFeeKobo?: number;
}

export class UpdateZoneDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ pattern: zoneCodePattern.source, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(zoneCodePattern)
  code?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @ApiPropertyOptional({
    minimum: 7500,
    type: Number,
    description: 'Customer-facing delivery fee in kobo for this zone. The ₦75 rider share is fixed.'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7500)
  deliveryFeeKobo?: number;
}

export class CreateLocationDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  zoneId!: string;

  @ApiProperty({ type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ pattern: slugPattern.source, type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(slugPattern)
  slug!: string;

  @ApiProperty({ enum: ['department', 'hostel'], type: String })
  @IsIn(['department', 'hostel'])
  type!: 'department' | 'hostel';

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(500)
  deliveryInstructions?: string | null;

  @ApiProperty({ default: true, type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ default: 0, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder!: number;
}

export class UpdateLocationDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  zoneId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ pattern: slugPattern.source, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(slugPattern)
  slug?: string;

  @ApiPropertyOptional({ enum: ['department', 'hostel'], type: String })
  @IsOptional()
  @IsIn(['department', 'hostel'])
  type?: 'department' | 'hostel';

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(500)
  deliveryInstructions?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class CreateDeliverySlotDto {
  @ApiProperty({ type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Campus local delivery time in HH:mm or HH:mm:ss.', type: String })
  @Transform(({ value }) => trimString(value))
  @Matches(timePattern)
  deliveryTime!: string;

  @ApiProperty({ default: 60, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  cutoffMinutes!: number;

  @ApiProperty({ default: true, type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ default: 0, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder!: number;
}

export class UpdateDeliverySlotDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Campus local delivery time in HH:mm or HH:mm:ss.',
    type: String
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(timePattern)
  deliveryTime?: string;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  cutoffMinutes?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class CampusRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  countryCode!: string;

  @ApiProperty({ type: Number })
  maxServiceFeeKobo!: number;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class CampusZoneRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: Number })
  deliveryFeeKobo!: number;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class CampusLocationRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  zoneId!: string;

  @ApiProperty({ type: String })
  zoneName!: string;

  @ApiProperty({ type: String })
  zoneCode!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ enum: ['department', 'hostel'], type: String })
  type!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveryInstructions!: string | null;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class DeliverySlotRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  deliveryTime!: string;

  @ApiProperty({ type: Number })
  cutoffMinutes!: number;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  orderingCutoffAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Boolean })
  acceptingOrders!: boolean | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class CampusListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => CampusRecordDto })
  data!: CampusRecordDto[];
}

export class CampusEnvelopeDto {
  @ApiProperty({ type: () => CampusRecordDto })
  data!: CampusRecordDto;
}

export class ZoneListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => CampusZoneRecordDto })
  data!: CampusZoneRecordDto[];
}

export class ZoneEnvelopeDto {
  @ApiProperty({ type: () => CampusZoneRecordDto })
  data!: CampusZoneRecordDto;
}

export class LocationListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => CampusLocationRecordDto })
  data!: CampusLocationRecordDto[];
}

export class LocationEnvelopeDto {
  @ApiProperty({ type: () => CampusLocationRecordDto })
  data!: CampusLocationRecordDto;
}

export class DeliverySlotListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => DeliverySlotRecordDto })
  data!: DeliverySlotRecordDto[];
}

export class DeliverySlotEnvelopeDto {
  @ApiProperty({ type: () => DeliverySlotRecordDto })
  data!: DeliverySlotRecordDto;
}
