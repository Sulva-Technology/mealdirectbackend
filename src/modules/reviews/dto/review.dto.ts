import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateReviewDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  menuItemId?: string;

  @ApiPropertyOptional({ maximum: 5, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  foodRating?: number;

  @ApiPropertyOptional({ maximum: 5, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  vendorRating?: number;

  @ApiPropertyOptional({ maximum: 5, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  deliveryRating?: number;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment?: string;
}

export class ReviewRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  reviewerId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  menuItemId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  vendorId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveryBatchId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  foodRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  vendorRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  deliveryRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'], type: String })
  moderationStatus!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class ReviewEnvelopeDto {
  @ApiProperty({ type: () => ReviewRecordDto })
  data!: ReviewRecordDto;
}

export class VendorReviewListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  menuItemId?: string;

  @ApiPropertyOptional({ maximum: 5, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class VendorReviewRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  orderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  menuItemId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  menuItemName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  vendorId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveryBatchId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  foodRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  vendorRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  deliveryRating!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'], type: String })
  moderationStatus!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class VendorReviewListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => VendorReviewRecordDto })
  data!: VendorReviewRecordDto[];
}
