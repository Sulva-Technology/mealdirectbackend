import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { OrderDetailDto, OrderSummaryDto } from '../../orders/dto/order-api.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

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

export class VendorOrderIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  orderId!: string;
}

export class VendorOrderListQueryDto {
  @ApiPropertyOptional({ enum: orderStatuses, type: String })
  @IsOptional()
  @IsIn(orderStatuses)
  status?: (typeof orderStatuses)[number];

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

export class VendorOrderListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => OrderSummaryDto })
  data!: OrderSummaryDto[];
}

export class VendorOrderDetailEnvelopeDto {
  @ApiProperty({ type: () => OrderDetailDto })
  data!: OrderDetailDto;
}
