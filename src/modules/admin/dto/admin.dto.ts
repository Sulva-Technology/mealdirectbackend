import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

const orderStatuses = [
  'accepted',
  'administratively_completed',
  'cancelled',
  'confirmed',
  'delivered',
  'expired',
  'out_for_delivery',
  'paid',
  'pending_payment',
  'preparing',
  'ready',
  'refunded'
] as const;
const batchStatuses = [
  'open',
  'closed',
  'assigned',
  'in_progress',
  'completed',
  'cancelled'
] as const;
const vendorStatuses = ['approved', 'deactivated', 'pending', 'suspended'] as const;
const riderStatuses = ['deactivated', 'pending', 'suspended', 'verified'] as const;
const settlementStatuses = ['approved', 'cancelled', 'draft', 'paid'] as const;
const reviewStatuses = ['approved', 'pending', 'rejected'] as const;
const accountStatuses = ['active', 'suspended', 'deactivated'] as const;
const beneficiaryTypes = ['rider', 'vendor'] as const;
const granularities = ['day', 'week', 'month'] as const;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class AdminCursorQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdminOrderListQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ enum: orderStatuses, type: String })
  @IsOptional()
  @IsIn(orderStatuses)
  status?: (typeof orderStatuses)[number];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  vendorId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  slotId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AdminBatchListQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ enum: batchStatuses, type: String })
  @IsOptional()
  @IsIn(batchStatuses)
  status?: (typeof batchStatuses)[number];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  vendorId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string;
}

export class AdminDirectoryQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AdminDashboardQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class AdminVendorListQueryDto extends AdminDirectoryQueryDto {
  @ApiPropertyOptional({ enum: vendorStatuses, type: String })
  @IsOptional()
  @IsIn(vendorStatuses)
  status?: (typeof vendorStatuses)[number];
}

export class AdminRiderListQueryDto extends AdminDirectoryQueryDto {
  @ApiPropertyOptional({ enum: riderStatuses, type: String })
  @IsOptional()
  @IsIn(riderStatuses)
  status?: (typeof riderStatuses)[number];
}

export class AdminUserListQueryDto extends AdminDirectoryQueryDto {
  @ApiPropertyOptional({ enum: accountStatuses, type: String })
  @IsOptional()
  @IsIn(accountStatuses)
  status?: (typeof accountStatuses)[number];
}

export class AdminInventoryQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  slotId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  vendorId?: string;

  @ApiPropertyOptional({ enum: ['available', 'low', 'sold_out'], type: String })
  @IsOptional()
  @IsIn(['available', 'low', 'sold_out'])
  state?: 'available' | 'low' | 'sold_out';
}

export class AdminEscalationQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ enum: ['open', 'investigating', 'resolved', 'rejected'], type: String })
  @IsOptional()
  @IsIn(['open', 'investigating', 'resolved', 'rejected'])
  status?: 'open' | 'investigating' | 'resolved' | 'rejected';

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  assignee?: string;
}

export class AdminSettlementQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ enum: settlementStatuses, type: String })
  @IsOptional()
  @IsIn(settlementStatuses)
  status?: (typeof settlementStatuses)[number];

  @ApiPropertyOptional({ enum: beneficiaryTypes, type: String })
  @IsOptional()
  @IsIn(beneficiaryTypes)
  beneficiaryType?: (typeof beneficiaryTypes)[number];
}

export class AdminReviewQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ enum: reviewStatuses, type: String })
  @IsOptional()
  @IsIn(reviewStatuses)
  status?: (typeof reviewStatuses)[number];

  @ApiPropertyOptional({ maximum: 5, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  vendorId?: string;
}

export class AdminAnalyticsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ enum: granularities, type: String })
  @IsOptional()
  @IsIn(granularities)
  granularity?: (typeof granularities)[number];
}

export class AdminAuditLogQueryDto extends AdminCursorQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  entityId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  requestId?: string;
}

export class UuidIdParamDto {
  @IsUUID('4')
  id!: string;
}

export class AdminOrderIdParamDto {
  @IsUUID('4')
  orderId!: string;
}

export class AdminBatchIdParamDto {
  @IsUUID('4')
  batchId!: string;
}

export class AdminVendorIdParamDto {
  @IsUUID('4')
  vendorId!: string;
}

export class AdminRiderIdParamDto {
  @IsUUID('4')
  riderId!: string;
}

export class AdminUserIdParamDto {
  @IsUUID('4')
  userId!: string;
}

export class AdminInventoryIdParamDto {
  @IsUUID('4')
  inventoryId!: string;
}

export class AdminReviewIdParamDto {
  @IsUUID('4')
  reviewId!: string;
}

export class AdminStatusTransitionDto {
  @IsIn(orderStatuses)
  status!: (typeof orderStatuses)[number];

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminReasonDto {
  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminAssignRiderDto {
  @IsUUID('4')
  riderId!: string;
}

export class AdminVendorDeliveryDto {
  @IsUUID('4')
  vendorId!: string;
}

export class AdminInventoryAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  delta!: number;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class AdminSettlementGenerationDto {
  @IsIn(beneficiaryTypes)
  beneficiaryType!: (typeof beneficiaryTypes)[number];

  @IsUUID('4')
  beneficiaryId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  settlementDate!: string;
}

export class AdminMarkPaidDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  externalReference!: string;
}

export class AdminSettlementAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  amountKobo!: number;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description!: string;
}

export class AdminCreateVendorDto {
  @IsUUID('4')
  campusId!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  legalName!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}

export class AdminPatchVendorDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AdminVendorUserDto {
  @IsUUID('4')
  userId!: string;

  @IsIn(['owner', 'staff'])
  role!: 'owner' | 'staff';
}

export class AdminModerateReviewDto {
  @IsIn(reviewStatuses)
  status!: (typeof reviewStatuses)[number];
}

export class AdminEscalationAssignDto {
  @IsUUID('4')
  adminUserId!: string;
}

export class AdminEscalationResolveDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolution!: string;
}

export class AdminCreateMembershipDto {
  @IsUUID('4')
  userId!: string;

  @IsIn(['campus_admin', 'super_admin'])
  role!: 'campus_admin' | 'super_admin';

  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}
