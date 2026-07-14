import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { IsDatabaseUuid } from '../../../common/validation.js';

const settlementStatuses = ['approved', 'cancelled', 'draft', 'paid'] as const;

export class VendorSettlementIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  id!: string;
}

export class VendorSettlementListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ example: '2026-06-01', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateFrom must be in YYYY-MM-DD format.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo must be in YYYY-MM-DD format.' })
  dateTo?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SettlementSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  vendorId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  riderId!: string | null;

  @ApiProperty({ example: '2026-06-15', type: String })
  settlementDate!: string;

  @ApiProperty({ enum: settlementStatuses, type: String })
  status!: string;

  @ApiProperty({ type: Number })
  grossFoodAmountKobo!: number;

  @ApiProperty({ type: Number })
  deliveryEarningsKobo!: number;

  @ApiProperty({
    description: 'Takeaway/packaging service fee reimbursed to the vendor.',
    type: Number
  })
  serviceFeeKobo!: number;

  @ApiProperty({ type: Number })
  refundsKobo!: number;

  @ApiProperty({ type: Number })
  adjustmentsKobo!: number;

  @ApiProperty({ type: Number })
  payableKobo!: number;

  @ApiProperty({ nullable: true, type: String })
  paidAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  externalReference!: string | null;

  @ApiProperty({ type: Number })
  lineCount!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class SettlementLineDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  settlementId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  orderNumber!: string | null;

  @ApiProperty({ type: String })
  lineType!: string;

  @ApiProperty({ type: Number })
  amountKobo!: number;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class SettlementDetailDto extends SettlementSummaryDto {
  @ApiProperty({ isArray: true, type: () => SettlementLineDto })
  lines!: SettlementLineDto[];
}

export class VendorSettlementListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => SettlementSummaryDto })
  data!: SettlementSummaryDto[];
}

export class VendorSettlementDetailEnvelopeDto {
  @ApiProperty({ type: () => SettlementDetailDto })
  data!: SettlementDetailDto;
}
