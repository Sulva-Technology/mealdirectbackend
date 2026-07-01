import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateIf,
  ValidateNested
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const phonePattern = /^[+0-9][0-9 ()-]{6,24}$/;
const unitTypeCodePattern = /^[a-z0-9_]+$/;
const deliveryModes = ['meal_direct_rider', 'vendor_delivery'] as const;
const vendorStatuses = ['approved', 'deactivated', 'pending', 'suspended'] as const;

export class MenuItemIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  itemId!: string;
}

export class UnitTypeIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  id!: string;
}

export class CreateMenuCategoryDto {
  @ApiProperty({ maxLength: 120, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class CreateUnitTypeDto {
  @ApiProperty({
    maxLength: 40,
    minLength: 1,
    pattern: unitTypeCodePattern.source,
    type: String,
    description: 'Immutable lowercase code, e.g. spoon, piece, plate.'
  })
  @IsString()
  @MaxLength(40)
  @Matches(unitTypeCodePattern)
  code!: string;

  @ApiProperty({ maxLength: 120, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiPropertyOptional({
    default: false,
    type: Boolean,
    description: 'When true, quantities count toward the three-spoon takeaway package limit.'
  })
  @IsOptional()
  @IsBoolean()
  countsTowardSpoonLimit?: boolean;
}

export class UpdateUnitTypeDto {
  @ApiPropertyOptional({ maxLength: 120, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  countsTowardSpoonLimit?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class OnboardVendorDto {
  @ApiProperty({ format: 'uuid', type: String, description: 'Campus the vendor operates on.' })
  @IsDatabaseUuid()
  campusId!: string;

  @ApiProperty({
    maxLength: 160,
    minLength: 2,
    type: String,
    description: 'Registered/legal business name.'
  })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  legalName!: string;

  @ApiProperty({ maxLength: 160, minLength: 2, type: String, description: 'Public display name.' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ApiPropertyOptional({ pattern: phonePattern.source, type: String })
  @IsOptional()
  @Matches(phonePattern)
  phone?: string;
}

export class UpdateVendorProfileDto {
  @ApiPropertyOptional({ maxLength: 160, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ pattern: phonePattern.source, nullable: true, type: String })
  @IsOptional()
  @Matches(phonePattern)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 2048, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  logoUrl?: string | null;

  @ApiPropertyOptional({ maxLength: 300, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  kitchenLocation?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    nullable: true,
    type: Number,
    description:
      'Per-vendor takeaway/packaging fee in kobo. Null clears to the global default; may not exceed the campus ceiling.'
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  serviceFeeKobo?: number | null;

  @ApiPropertyOptional({ enum: deliveryModes, type: String })
  @IsOptional()
  @IsIn(deliveryModes)
  defaultDeliveryMode?: (typeof deliveryModes)[number];
}

export class UpsertPayoutAccountDto {
  @ApiProperty({ maxLength: 120, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName!: string;

  @ApiPropertyOptional({ maxLength: 20, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  bankCode?: string;

  @ApiProperty({ maxLength: 160, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  accountName!: string;

  @ApiProperty({ description: 'Full account number for masking before storage.', type: String })
  @Matches(/^[0-9]{6,20}$/)
  accountNumber!: string;

  @ApiPropertyOptional({ maxLength: 80, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  paystackRecipientCode?: string;
}

export class CreateMenuItemDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @IsOptional()
  @IsDatabaseUuid()
  categoryId?: string | null;

  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  unitTypeId!: string;

  @ApiProperty({ maxLength: 180, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 2048, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiProperty({ minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceKobo!: number;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateMenuItemDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @IsOptional()
  @IsDatabaseUuid()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  unitTypeId?: string;

  @ApiPropertyOptional({ maxLength: 180, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 2048, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceKobo?: number;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class AvailabilityEntryDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  deliverySlotId!: string;

  @ApiProperty({ maximum: 6, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  available!: boolean;

  @ApiPropertyOptional({ example: '2026-06-15', nullable: true, type: String })
  @IsOptional()
  @Matches(datePattern)
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-06-30', nullable: true, type: String })
  @IsOptional()
  @Matches(datePattern)
  validUntil?: string | null;
}

export class AvailabilityUpdateDto {
  @ApiProperty({ isArray: true, type: () => AvailabilityEntryDto })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityEntryDto)
  entries!: AvailabilityEntryDto[];
}

export class VendorProfileDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  legalName!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  kitchenLocation!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  serviceFeeKobo!: number | null;

  @ApiProperty({ enum: vendorStatuses, type: String })
  status!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ enum: deliveryModes, type: String })
  defaultDeliveryMode!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class VendorProfileEnvelopeDto {
  @ApiProperty({ type: () => VendorProfileDto })
  data!: VendorProfileDto;
}

export class VendorOnboardResultDto {
  @ApiProperty({ type: () => VendorProfileDto })
  vendor!: VendorProfileDto;

  @ApiProperty({
    type: Boolean,
    description:
      'Always true: the client must refresh its session so the new vendor_id appears in the JWT.'
  })
  tokenRefreshRequired!: boolean;
}

export class VendorOnboardEnvelopeDto {
  @ApiProperty({ type: () => VendorOnboardResultDto })
  data!: VendorOnboardResultDto;
}

export class VendorPayoutAccountDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  paystackRecipientCode!: string | null;

  @ApiProperty({ type: String })
  bankName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  bankCode!: string | null;

  @ApiProperty({ type: String })
  maskedAccountNumber!: string;

  @ApiProperty({ type: String })
  accountName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  verifiedAt!: string | null;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class VendorPayoutAccountEnvelopeDto {
  @ApiProperty({ nullable: true, type: () => VendorPayoutAccountDto })
  data!: VendorPayoutAccountDto | null;
}

export class MenuCategoryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class MenuCategoryEnvelopeDto {
  @ApiProperty({ type: () => MenuCategoryDto })
  data!: MenuCategoryDto;
}

export class UnitTypeDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: Boolean })
  countsTowardSpoonLimit!: boolean;

  @ApiProperty({ type: Boolean })
  active!: boolean;
}

export class UnitTypeEnvelopeDto {
  @ApiProperty({ type: () => UnitTypeDto })
  data!: UnitTypeDto;
}

export class UnitTypeListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => UnitTypeDto })
  data!: UnitTypeDto[];
}

export class MenuMetadataDto {
  @ApiProperty({ isArray: true, type: () => MenuCategoryDto })
  categories!: MenuCategoryDto[];

  @ApiProperty({ isArray: true, type: () => UnitTypeDto })
  unitTypes!: UnitTypeDto[];
}

export class MenuMetadataEnvelopeDto {
  @ApiProperty({ type: () => MenuMetadataDto })
  data!: MenuMetadataDto;
}

export class VendorMenuItemDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  categoryId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  categoryName!: string | null;

  @ApiProperty({ format: 'uuid', type: String })
  unitTypeId!: string;

  @ApiProperty({ type: String })
  unitCode!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  imageUrl!: string | null;

  @ApiProperty({ type: Number })
  priceKobo!: number;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class VendorMenuItemEnvelopeDto {
  @ApiProperty({ type: () => VendorMenuItemDto })
  data!: VendorMenuItemDto;
}

export class VendorMenuItemListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => VendorMenuItemDto })
  data!: VendorMenuItemDto[];
}

export class AvailabilityEntryResponseDto extends AvailabilityEntryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
}

export class AvailabilityListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => AvailabilityEntryResponseDto })
  data!: AvailabilityEntryResponseDto[];
}
