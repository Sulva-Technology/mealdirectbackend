import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { OrderSummaryDto } from '../../orders/dto/order-api.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

const batchStatuses = [
  'open',
  'closed',
  'assigned',
  'in_progress',
  'completed',
  'cancelled'
] as const;

export class BatchIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  batchId!: string;
}

export class BatchListQueryDto {
  @ApiPropertyOptional({ enum: batchStatuses, type: String })
  @IsOptional()
  @IsIn(batchStatuses)
  status?: (typeof batchStatuses)[number];

  @ApiPropertyOptional({ example: '2026-06-15', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format.' })
  date?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class BatchSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  deliverySlotId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  zoneId!: string;

  @ApiProperty({ type: String })
  batchNumber!: string;

  @ApiProperty({ enum: batchStatuses, type: String })
  status!: string;

  @ApiProperty({ type: String })
  deliveryMode!: string;

  @ApiProperty({ type: Number })
  orderCount!: number;

  @ApiProperty({ type: Number })
  deliveryEarningsKobo!: number;

  @ApiProperty({ type: String })
  cutoffAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  closedAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class BatchDetailDto extends BatchSummaryDto {
  @ApiProperty({ isArray: true, type: () => OrderSummaryDto })
  orders!: OrderSummaryDto[];
}

export class BatchListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => BatchSummaryDto })
  data!: BatchSummaryDto[];
}

export class BatchDetailEnvelopeDto {
  @ApiProperty({ type: () => BatchDetailDto })
  data!: BatchDetailDto;
}
