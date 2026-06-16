import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  NotEquals
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class InventoryIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  inventoryId!: string;
}

export class VendorInventoryQueryDto {
  @ApiProperty({ example: '2026-06-16', type: String })
  @Matches(datePattern)
  date!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  slotId?: string;
}

export class UpdateInventoryDto {
  @ApiProperty({ minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityTotal!: number;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class CreateInventoryAdjustmentDto {
  @ApiProperty({ type: Number })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  adjustmentQuantity!: number;

  @ApiProperty({ maxLength: 500, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class InventoryAdjustmentDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  inventoryId!: string;

  @ApiProperty({ type: Number })
  adjustmentQuantity!: number;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  actorUserId!: string | null;

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class VendorInventoryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  menuItemId!: string;

  @ApiProperty({ type: String })
  menuItemName!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  categoryId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  categoryName!: string | null;

  @ApiProperty({ format: 'uuid', type: String })
  unitTypeId!: string;

  @ApiProperty({ type: String })
  unitCode!: string;

  @ApiProperty({ type: String })
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  deliverySlotId!: string;

  @ApiProperty({ type: String })
  deliverySlotName!: string;

  @ApiProperty({ type: Number })
  quantityTotal!: number;

  @ApiProperty({ type: Number })
  quantityReserved!: number;

  @ApiProperty({ type: Number })
  quantitySold!: number;

  @ApiProperty({ type: Number })
  quantityAdjusted!: number;

  @ApiProperty({ type: Number })
  remainingQuantity!: number;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;

  @ApiProperty({ isArray: true, type: () => InventoryAdjustmentDto })
  adjustments!: InventoryAdjustmentDto[];
}

export class VendorInventoryListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => VendorInventoryDto })
  data!: VendorInventoryDto[];
}

export class VendorInventoryEnvelopeDto {
  @ApiProperty({ type: () => VendorInventoryDto })
  data!: VendorInventoryDto;
}

export class InventoryAdjustmentResponseDto {
  @ApiProperty({ type: () => InventoryAdjustmentDto })
  adjustment!: InventoryAdjustmentDto;

  @ApiProperty({ type: () => VendorInventoryDto })
  inventory!: VendorInventoryDto;
}

export class InventoryAdjustmentEnvelopeDto {
  @ApiProperty({ type: () => InventoryAdjustmentResponseDto })
  data!: InventoryAdjustmentResponseDto;
}
