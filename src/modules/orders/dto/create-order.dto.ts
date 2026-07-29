import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
const paymentMethods = ['wallet', 'paystack'] as const;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

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

  // Required only when the menu item is flagged requires_soup: the chosen soup from the
  // vendor's soup list. Validated and persisted by the order RPC; ignored for items that
  // don't require a soup.
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Chosen soup option id (from the vendor's soup list). Required when the menu item requires a soup.",
    type: String
  })
  @IsOptional()
  @IsDatabaseUuid()
  soupOptionId?: string;
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
    description: 'Hostel room number. Required when the selected delivery location is a hostel.',
    maxLength: 32,
    type: String
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(32)
  roomNumber?: string;

  @ApiPropertyOptional({
    description:
      'Set true to acknowledge and accept the large-order surcharge (1.5% + ₦100) required for order totals above the standard ₦2490 cap. Orders over the cap are rejected unless this is true.',
    type: Boolean
  })
  @IsOptional()
  @IsBoolean()
  acceptLargeOrderSurcharge?: boolean;

  @ApiPropertyOptional({
    description:
      "Funding source. 'wallet' debits the balance and creates the order already paid; 'paystack' (the default) creates a pending-payment order and returns a checkout link. A wallet order with too little balance is rejected with 402 WALLET_INSUFFICIENT_BALANCE.",
    enum: paymentMethods,
    type: String
  })
  @IsOptional()
  @IsIn(paymentMethods)
  paymentMethod?: (typeof paymentMethods)[number];

  @ApiPropertyOptional({
    description: 'Deliver to a specific point (hostel room / classroom). Adds the point surcharge.'
  })
  @IsOptional()
  @IsBoolean()
  pointDelivery?: boolean;

  @ApiProperty({ isArray: true, minItems: 1, type: () => CreateOrderItemDto })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
