import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';

const discountTypes = ['fixed', 'percent'] as const;

export class ValidatePromotionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsInt()
  @Min(0)
  subtotalKobo!: number;
}

export class CreatePromotionDto {
  @IsOptional()
  @IsDatabaseUuid()
  campusId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsIn(discountTypes)
  discountType!: (typeof discountTypes)[number];

  @IsInt()
  @Min(1)
  discountValue!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderKobo?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscountKobo?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalUsageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;
}
