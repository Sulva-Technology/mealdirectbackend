import { Type } from 'class-transformer';
import { IsDatabaseUuid } from '../../../common/validation.js';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateNested
} from 'class-validator';

const deliveryModes = ['vendor_delivery', 'meal_direct_rider'] as const;

export class CreateOrderItemDto {
  @IsDatabaseUuid()
  menuItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsDatabaseUuid()
  campusId!: string;

  @IsDatabaseUuid()
  vendorId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate!: string;

  @IsDatabaseUuid()
  deliverySlotId!: string;

  @IsDatabaseUuid()
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
