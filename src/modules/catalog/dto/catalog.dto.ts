import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { IsDatabaseUuid } from '../../../common/validation.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class VendorIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  vendorId!: string;
}

export class VendorListQueryDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  campusId!: string;

  @ApiPropertyOptional({ example: '2026-06-15', type: String })
  @IsOptional()
  @Matches(datePattern)
  date?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  slotId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  locationId?: string;
}

export class VendorMenuQueryDto {
  @ApiPropertyOptional({ example: '2026-06-15', type: String })
  @IsOptional()
  @Matches(datePattern)
  date?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  slotId?: string;
}

export class CatalogVendorDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  kitchenLocation!: string | null;

  @ApiProperty({ enum: ['meal_direct_rider', 'vendor_delivery'], type: String })
  defaultDeliveryMode!: string;
}

export class MenuItemDto {
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

  @ApiPropertyOptional({ nullable: true, type: Number })
  remainingQuantity!: number | null;

  @ApiProperty({
    description: 'When true, this item contributes to takeaway packaging rules and fees.',
    type: Boolean
  })
  countsTowardSpoonLimit!: boolean;
}

export class CatalogVendorListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => CatalogVendorDto })
  data!: CatalogVendorDto[];
}

export class CatalogVendorEnvelopeDto {
  @ApiProperty({ type: () => CatalogVendorDto })
  data!: CatalogVendorDto;
}

export class MenuItemListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => MenuItemDto })
  data!: MenuItemDto[];
}
