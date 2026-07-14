import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDatabaseUuid } from '../../../common/validation.js';
import type { RefundStatus } from '../payments.types.js';

const refundStatuses = [
  'requested',
  'approved',
  'processing',
  'succeeded',
  'failed',
  'cancelled'
] as const;

const resolutionStatuses = ['succeeded', 'failed', 'cancelled'] as const;

export class RefundIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  refundId!: string;
}

export class AdminRefundListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: refundStatuses })
  @IsOptional()
  @IsIn(refundStatuses)
  status?: RefundStatus;
}

export class RefundInitiateDto {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountKobo!: number;

  @ApiProperty({ maxLength: 500, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RefundManualResolveDto {
  @ApiProperty({ maxLength: 1000, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

export class RefundNoteDto {
  @ApiProperty({ maxLength: 2000, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}

export class RefundResolutionDto {
  @ApiProperty({ enum: resolutionStatuses })
  @IsIn(resolutionStatuses)
  status!: 'succeeded' | 'failed' | 'cancelled';

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  resolutionNote?: string;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  failureReason?: string;
}

export class AdminRefundRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  paymentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  orderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  campusId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  vendorId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerEmail!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerReference!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerTransactionId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerRefundReference!: string | null;

  @ApiProperty({ type: Number })
  amountKobo!: number;

  @ApiProperty({ type: String })
  reasonCode!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  reasonText!: string | null;

  @ApiProperty({ enum: refundStatuses })
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  failureReason!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolutionNote!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  requestedBy!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolvedBy!: string | null;

  @ApiProperty({ type: String })
  requestedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  processedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  updatedAt!: string | null;
}

export class AdminRefundListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => AdminRefundRecordDto })
  data!: AdminRefundRecordDto[];
}

export class AdminRefundEnvelopeDto {
  @ApiProperty({ type: () => AdminRefundRecordDto })
  data!: AdminRefundRecordDto;
}
