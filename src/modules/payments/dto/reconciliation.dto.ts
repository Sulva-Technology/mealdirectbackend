import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDatabaseUuid } from '../../../common/validation.js';
import type {
  ReconciliationIssueStatus,
  ReconciliationIssueType,
  ReconciliationSeverity
} from '../reconciliation.types.js';

const issueTypes = [
  'initialized_unconfirmed',
  'paid_order_pending',
  'webhook_processing_failed',
  'provider_success_not_local',
  'duplicate_success',
  'amount_mismatch',
  'currency_mismatch',
  'refund_stuck'
] as const;

const issueStatuses = ['open', 'investigating', 'resolved', 'ignored'] as const;
const severities = ['info', 'warning', 'critical'] as const;
const reviewStatuses = ['investigating', 'resolved', 'ignored'] as const;

export class ReconciliationIssueIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  issueId!: string;
}

export class ReconciliationIssueListQueryDto {
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

  @ApiPropertyOptional({ enum: issueStatuses })
  @IsOptional()
  @IsIn(issueStatuses)
  status?: ReconciliationIssueStatus;

  @ApiPropertyOptional({ enum: issueTypes })
  @IsOptional()
  @IsIn(issueTypes)
  issueType?: ReconciliationIssueType;

  @ApiPropertyOptional({ enum: severities })
  @IsOptional()
  @IsIn(severities)
  severity?: ReconciliationSeverity;
}

export class ReconciliationReviewDto {
  @ApiProperty({ enum: reviewStatuses })
  @IsIn(reviewStatuses)
  status!: Exclude<ReconciliationIssueStatus, 'open'>;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  resolutionNote?: string;
}

export class ReconciliationNoteDto {
  @ApiProperty({ maxLength: 1000, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}

export class ReconciliationIssueRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: issueTypes })
  issueType!: string;

  @ApiProperty({ enum: issueStatuses })
  status!: string;

  @ApiProperty({ enum: severities })
  severity!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  paymentId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  orderId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  refundId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  campusId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerReference!: string | null;

  @ApiProperty({ type: Object })
  detail!: Record<string, unknown>;

  @ApiProperty({ type: String })
  firstDetectedAt!: string;

  @ApiProperty({ type: String })
  lastDetectedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  reviewedBy!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  reviewedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolutionNote!: string | null;
}

export class ReconciliationNoteRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  issueId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  authorId!: string | null;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class ReconciliationIssueDetailDto extends ReconciliationIssueRecordDto {
  @ApiProperty({ isArray: true, type: () => ReconciliationNoteRecordDto })
  notes!: ReconciliationNoteRecordDto[];
}

export class ReconciliationIssueListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => ReconciliationIssueRecordDto })
  data!: ReconciliationIssueRecordDto[];
}

export class ReconciliationIssueEnvelopeDto {
  @ApiProperty({ type: () => ReconciliationIssueRecordDto })
  data!: ReconciliationIssueRecordDto;
}

export class ReconciliationIssueDetailEnvelopeDto {
  @ApiProperty({ type: () => ReconciliationIssueDetailDto })
  data!: ReconciliationIssueDetailDto;
}

export class ReconciliationNoteEnvelopeDto {
  @ApiProperty({ type: () => ReconciliationNoteRecordDto })
  data!: ReconciliationNoteRecordDto;
}

export class ReconciliationScanResultDto {
  @ApiProperty({ type: Number })
  detected!: number;
}

export class ReconciliationScanEnvelopeDto {
  @ApiProperty({ type: () => ReconciliationScanResultDto })
  data!: ReconciliationScanResultDto;
}
