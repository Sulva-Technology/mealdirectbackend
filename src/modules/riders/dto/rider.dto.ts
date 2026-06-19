import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

import { OrderDetailDto } from '../../orders/dto/order-api.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

const riderStatuses = ['deactivated', 'pending', 'suspended', 'verified'] as const;
const assignmentStatuses = ['accepted', 'assigned', 'cancelled', 'completed', 'picked_up'] as const;
const settlementStatuses = ['approved', 'cancelled', 'draft', 'paid'] as const;
const issueCategories = [
  'access_restriction',
  'customer_unavailable',
  'damaged_package',
  'other',
  'wrong_location'
] as const;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RiderProfileUpdateDto {
  @ApiPropertyOptional({ maxLength: 120, minLength: 2, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^[+0-9][0-9 ()-]{6,24}$/)
  phone?: string;
}

export class RiderAvailabilityDto {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  available!: boolean;
}

export class RiderProfileDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  campusName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  userId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  phone!: string;

  @ApiProperty({ enum: riderStatuses, type: String })
  status!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Boolean })
  available!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  verifiedAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class RiderProfileEnvelopeDto {
  @ApiProperty({ type: () => RiderProfileDto })
  data!: RiderProfileDto;
}

export class RiderAssignmentIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  assignmentId!: string;
}

export class RiderOrderIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  orderId!: string;
}

export class RiderSettlementIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  id!: string;
}

export class RiderAssignmentListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ example: '2026-06-15', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format.' })
  date?: string;

  @ApiPropertyOptional({ enum: assignmentStatuses, type: String })
  @IsOptional()
  @IsIn(assignmentStatuses)
  status?: (typeof assignmentStatuses)[number];

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class RiderAssignmentSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  batchId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  riderId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  vendorDisplayName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  vendorPhone!: string | null;

  @ApiProperty({ type: String })
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  deliverySlotId!: string;

  @ApiProperty({ type: String })
  deliverySlotName!: string;

  @ApiProperty({ type: String })
  deliveryTime!: string;

  @ApiProperty({ format: 'uuid', type: String })
  zoneId!: string;

  @ApiProperty({ type: String })
  zoneName!: string;

  @ApiProperty({ enum: assignmentStatuses, type: String })
  status!: string;

  @ApiProperty({ type: String })
  batchStatus!: string;

  @ApiProperty({ type: Number })
  orderCount!: number;

  @ApiProperty({ type: Number })
  deliveryEarningsKobo!: number;

  @ApiProperty({ type: String })
  assignedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  acceptedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  completedAt!: string | null;
}

export class RiderAssignmentDetailDto extends RiderAssignmentSummaryDto {
  @ApiProperty({ isArray: true, type: () => OrderDetailDto })
  orders!: OrderDetailDto[];
}

export class RiderAssignmentListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => RiderAssignmentSummaryDto })
  data!: RiderAssignmentSummaryDto[];
}

export class RiderAssignmentDetailEnvelopeDto {
  @ApiProperty({ type: () => RiderAssignmentDetailDto })
  data!: RiderAssignmentDetailDto;
}

export class RiderOrderDetailDto extends OrderDetailDto {
  @ApiProperty({ format: 'uuid', type: String })
  assignmentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  batchId!: string;

  @ApiProperty({ enum: assignmentStatuses, type: String })
  assignmentStatus!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerDisplayName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerPhone!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveryInstructions!: string | null;

  @ApiProperty({ type: String })
  zoneName!: string;
}

export class RiderOrderDetailEnvelopeDto {
  @ApiProperty({ type: () => RiderOrderDetailDto })
  data!: RiderOrderDetailDto;
}

export class CreateRiderIssueDto {
  @ApiProperty({ enum: issueCategories, type: String })
  @IsIn(issueCategories)
  category!: (typeof issueCategories)[number];

  @ApiProperty({ maxLength: 1000, minLength: 5, type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description!: string;
}

export class RiderIssueDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ type: String })
  category!: string;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String })
  openedAt!: string;
}

export class RiderIssueEnvelopeDto {
  @ApiProperty({ type: () => RiderIssueDto })
  data!: RiderIssueDto;
}

export class RiderEarningsQueryDto {
  @ApiPropertyOptional({ example: '2026-06-01', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateFrom must be in YYYY-MM-DD format.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30', pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo must be in YYYY-MM-DD format.' })
  dateTo?: string;
}

export class RiderEarningsBatchDto {
  @ApiProperty({ format: 'uuid', type: String })
  assignmentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  batchId!: string;

  @ApiProperty({ type: String })
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  vendorDisplayName!: string;

  @ApiProperty({ type: Number })
  deliveredOrderCount!: number;

  @ApiProperty({ type: Number })
  confirmedOrderCount!: number;

  @ApiProperty({ type: Number })
  pendingAmountKobo!: number;

  @ApiProperty({ type: Number })
  settledAmountKobo!: number;

  @ApiProperty({ type: Number })
  totalAmountKobo!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  settlementId!: string | null;

  @ApiPropertyOptional({ enum: settlementStatuses, nullable: true, type: String })
  settlementStatus!: string | null;
}

export class RiderEarningsSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  riderId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  dateFrom!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dateTo!: string | null;

  @ApiProperty({ type: Number })
  deliveredOrderCount!: number;

  @ApiProperty({ type: Number })
  confirmedOrderCount!: number;

  @ApiProperty({ type: Number })
  pendingAmountKobo!: number;

  @ApiProperty({ type: Number })
  settledAmountKobo!: number;

  @ApiProperty({ type: Number })
  totalAmountKobo!: number;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: Number })
  ratePerOrderKobo!: number;

  @ApiProperty({ isArray: true, type: () => RiderEarningsBatchDto })
  batches!: RiderEarningsBatchDto[];
}

export class RiderEarningsEnvelopeDto {
  @ApiProperty({ type: () => RiderEarningsSummaryDto })
  data!: RiderEarningsSummaryDto;
}

export class RiderSettlementListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ enum: settlementStatuses, type: String })
  @IsOptional()
  @IsIn(settlementStatuses)
  status?: (typeof settlementStatuses)[number];

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class RiderSettlementSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  riderId!: string;

  @ApiProperty({ type: String })
  settlementDate!: string;

  @ApiProperty({ enum: settlementStatuses, type: String })
  status!: string;

  @ApiProperty({ type: Number })
  deliveryEarningsKobo!: number;

  @ApiProperty({ type: Number })
  adjustmentsKobo!: number;

  @ApiProperty({ type: Number })
  payableKobo!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  paidAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  externalReference!: string | null;

  @ApiProperty({ type: Number })
  lineCount!: number;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class RiderSettlementLineDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  settlementId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
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

export class RiderSettlementDetailDto extends RiderSettlementSummaryDto {
  @ApiProperty({ isArray: true, type: () => RiderSettlementLineDto })
  lines!: RiderSettlementLineDto[];
}

export class RiderSettlementListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => RiderSettlementSummaryDto })
  data!: RiderSettlementSummaryDto[];
}

export class RiderSettlementDetailEnvelopeDto {
  @ApiProperty({ type: () => RiderSettlementDetailDto })
  data!: RiderSettlementDetailDto;
}
