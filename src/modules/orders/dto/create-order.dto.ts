import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateNested
} from 'class-validator';

const deliveryModes = ['vendor_delivery', 'meal_direct_rider'] as const;

export class CreateOrderItemDto {
  @IsUUID()
  menuItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsUUID()
  campusId!: string;

  @IsUUID()
  vendorId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate!: string;

  @IsUUID()
  deliverySlotId!: string;

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @IsIn(deliveryModes)
  deliveryMode?: (typeof deliveryModes)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
