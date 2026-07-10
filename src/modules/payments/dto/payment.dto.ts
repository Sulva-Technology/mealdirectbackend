import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';
import type { PaymentStatus } from '../payments.types.js';

const paymentStatuses = ['initialized', 'pending', 'successful', 'failed', 'refunded'] as const;

export class PaymentIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  paymentId!: string;
}

export class InitiateRefundDto {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountKobo!: number;

  @ApiProperty({ maxLength: 80, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  reasonCode!: string;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reasonText?: string;
}

export class ForcePaymentPaidDto {
  @ApiProperty({ maxLength: 500, minLength: 3, type: String })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class PaystackInitializationDto {
  @ApiProperty({ format: 'uuid', type: String })
  paymentId!: string;

  @ApiProperty({ type: String })
  authorizationUrl!: string;

  @ApiProperty({ type: String })
  accessCode!: string;

  @ApiProperty({ type: String })
  reference!: string;
}

export class PaystackInitializationEnvelopeDto {
  @ApiProperty({ type: () => PaystackInitializationDto })
  data!: PaystackInitializationDto;
}

export class AdminPaymentDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ type: String })
  orderNumber!: string;

  @ApiProperty({ format: 'uuid', type: String })
  customerId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerEmail!: string | null;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ type: String })
  orderStatus!: string;

  @ApiProperty({ type: Number })
  orderTotalKobo!: number;

  @ApiProperty({ type: String })
  providerReference!: string;

  @ApiProperty({ type: String })
  paymentStatus!: string;

  @ApiProperty({ type: Number })
  expectedAmountKobo!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  paidAmountKobo!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerTransactionId!: string | null;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  initializedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  paidAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  verifiedAt!: string | null;
}

export class AdminPaymentListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => AdminPaymentDto })
  data!: AdminPaymentDto[];
}

export class AdminPaymentEnvelopeDto {
  @ApiProperty({ type: () => AdminPaymentDto })
  data!: AdminPaymentDto;
}

export class PaymentReconciliationDto {
  @ApiProperty({ format: 'uuid', type: String })
  paymentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ type: String })
  providerReference!: string;

  @ApiProperty({ enum: ['successful'], type: String })
  status!: 'successful';
}

export class PaymentReconciliationEnvelopeDto {
  @ApiProperty({ type: () => PaymentReconciliationDto })
  data!: PaymentReconciliationDto;
}

export class RefundDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  paymentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerRefundReference!: string | null;

  @ApiProperty({ type: Number })
  amountKobo!: number;

  @ApiProperty({ type: String })
  reasonCode!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  reasonText!: string | null;

  @ApiProperty({ type: String })
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  requestedBy!: string | null;

  @ApiProperty({ type: String })
  requestedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  processedAt!: string | null;
}

export class RefundEnvelopeDto {
  @ApiProperty({ type: () => RefundDto })
  data!: RefundDto;
}

export class AdminPaymentListQueryDto {
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

  @ApiPropertyOptional({ enum: paymentStatuses })
  @IsOptional()
  @IsIn(paymentStatuses)
  status?: PaymentStatus;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  vendorId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  customerId?: string;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class AdminPaymentDetailDto extends AdminPaymentDto {
  @ApiProperty({ type: Boolean })
  webhookReceived!: boolean;

  @ApiProperty({ type: Number })
  webhookCount!: number;

  @ApiProperty({ enum: ['verified', 'unverified'], type: String })
  verificationStatus!: string;

  @ApiProperty({ type: String })
  refundStatus!: string;

  @ApiProperty({ type: Number })
  refundedAmountKobo!: number;

  @ApiProperty({ type: Number })
  settlementImpactKobo!: number;
}

export class AdminPaymentDetailEnvelopeDto {
  @ApiProperty({ type: () => AdminPaymentDetailDto })
  data!: AdminPaymentDetailDto;
}
