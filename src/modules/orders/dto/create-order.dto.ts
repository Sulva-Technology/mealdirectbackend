import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDatabaseUuid } from '../../../common/validation.js';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

const deliveryModes = ['vendor_delivery', 'meal_direct_rider'] as const;

export class CreateOrderItemDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  menuItemId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  quantity!: number;

  // Flexible per-item customization snapshot. Accepts an arbitrary JSON object so the client can
  // send spoonsCount, customFoodType, customProtein, customFoodSelections, drinks, and any future
  // keys without a backend change. Stored verbatim as order_items.customization jsonb.
  @ApiPropertyOptional({
    additionalProperties: true,
    description:
      'Per-item customization object (e.g. spoonsCount, customFoodType, customProtein, customFoodSelections, drinks). Stored and returned verbatim.',
    type: Object
  })
  @IsOptional()
  @IsObject()
  customization?: Record<string, unknown>;
}

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  vendorId!: string;

  @ApiProperty({ example: '2026-06-20', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  deliverySlotId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  locationId!: string;

  @ApiPropertyOptional({ enum: deliveryModes, type: String })
  @IsOptional()
  @IsIn(deliveryModes)
  deliveryMode?: (typeof deliveryModes)[number];

  @ApiPropertyOptional({ maxLength: 64, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionCode?: string;

  @ApiPropertyOptional({
    description: 'Order-level delivery note / special instructions.',
    maxLength: 1000,
    type: String
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialInstructions?: string;

  @ApiPropertyOptional({
    description:
      'Set true to acknowledge and accept the large-order surcharge (1.5% + ₦100) required for order totals above the standard ₦2490 cap. Orders over the cap are rejected unless this is true.',
    type: Boolean
  })
  @IsOptional()
  @IsBoolean()
  acceptLargeOrderSurcharge?: boolean;

  @ApiProperty({ isArray: true, minItems: 1, type: () => CreateOrderItemDto })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
