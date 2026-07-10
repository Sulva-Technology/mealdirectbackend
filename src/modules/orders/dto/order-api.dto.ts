import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
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

export class OrderIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  orderId!: string;
}

export class OrderListQueryDto {
  @ApiPropertyOptional({ enum: orderStatuses, type: String })
  @IsOptional()
  @IsIn(orderStatuses)
  status?: (typeof orderStatuses)[number];
}

export class OrderQuoteItemDto {
  @ApiProperty({ format: 'uuid', type: String })
  menuItemId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  remainingQuantity!: number;

  @ApiProperty({ type: Number })
  unitPriceKobo!: number;

  @ApiProperty({ type: Number })
  lineTotalKobo!: number;

  @ApiProperty({
    description: 'When true, this line contributes to takeaway packaging rules and fees.',
    type: Boolean
  })
  countsTowardSpoonLimit!: boolean;

  @ApiProperty({
    description:
      'When true, this line pulls the flat takeaway/service fee (independent of the spoon-limit cap).',
    type: Boolean
  })
  triggersTakeawayFee!: boolean;
}

export class OrderQuoteDto {
  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: Number })
  foodSubtotalKobo!: number;

  @ApiProperty({ type: Number })
  deliveryFeeKobo!: number;

  @ApiProperty({ type: Number })
  serviceFeeKobo!: number;

  @ApiProperty({ type: Number })
  discountKobo!: number;

  @ApiProperty({
    description:
      'Large-order surcharge (1.5% + ₦100) already included in totalKobo. Zero when the order does not exceed the standard cap.',
    type: Number
  })
  largeOrderSurchargeKobo!: number;

  @ApiProperty({
    description:
      'True when the total exceeds the standard ₦2490 cap. Show the surcharge notice and require acceptLargeOrderSurcharge on create.',
    type: Boolean
  })
  exceedsStandardCap!: boolean;

  @ApiProperty({ type: Number })
  totalKobo!: number;

  @ApiProperty({ isArray: true, type: () => OrderQuoteItemDto })
  items!: OrderQuoteItemDto[];
}

export class DeliveryHandoffDto {
  @ApiProperty({
    pattern: '^[0-9]{4}$',
    type: String,
    description: 'Code the customer gives to the rider after receiving the order.'
  })
  code!: string;

  @ApiProperty({
    type: String,
    description: 'Customer-facing instruction to show with the delivery code.'
  })
  instruction!: string;
}

export class CreatedOrderDto {
  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: () => DeliveryHandoffDto,
    description: 'Immediate pop-up payload for the customer after order creation.'
  })
  deliveryHandoff!: DeliveryHandoffDto | null;
}

export class OrderSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  orderNumber!: string;

  @ApiProperty({ format: 'uuid', type: String })
  customerId!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Customer display name. Present only on vendor/admin/rider order views.'
  })
  customerDisplayName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Customer phone number. Present only on vendor/admin/rider order views.'
  })
  customerPhone?: string | null;

  @ApiProperty({ format: 'uuid', type: String })
  campusId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  vendorDisplayName!: string;

  @ApiProperty({ type: String })
  serviceDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  deliverySlotId!: string;

  @ApiProperty({ type: String })
  deliverySlotName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  locationId!: string;

  @ApiProperty({ type: String })
  locationName!: string;

  @ApiProperty({ enum: orderStatuses, type: String })
  orderStatus!: string;

  @ApiProperty({ type: String })
  deliveryMode!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  specialInstructions!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Hostel room number when the delivery location is a hostel.'
  })
  roomNumber!: string | null;

  @ApiProperty({ type: Number })
  foodSubtotalKobo!: number;

  @ApiProperty({ type: Number })
  deliveryFeeKobo!: number;

  @ApiProperty({ type: Number })
  serviceFeeKobo!: number;

  @ApiProperty({ type: Number })
  discountKobo!: number;

  @ApiProperty({
    description: 'Large-order surcharge (1.5% + ₦100) charged on this order. Included in totalKobo.',
    type: Number
  })
  largeOrderSurchargeKobo!: number;

  @ApiProperty({ type: Number })
  totalKobo!: number;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  paidAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  confirmedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Delivery hand-off code to read to the rider after receiving the order.'
  })
  deliveryCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: () => DeliveryHandoffDto,
    description: 'Customer-facing code + instruction payload for delivery hand-off.'
  })
  deliveryHandoff?: DeliveryHandoffDto | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    type: String,
    description: 'Delivery batch this order belongs to, when batched. Powers the batch chat.'
  })
  batchId?: string | null;
}

export class OrderItemDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  menuItemId!: string;

  @ApiProperty({ type: String })
  itemName!: string;

  @ApiProperty({ type: String })
  unitType!: string;

  @ApiProperty({ type: Number })
  unitPriceKobo!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  lineTotalKobo!: number;

  @ApiProperty({ type: Object, additionalProperties: true })
  customization!: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'The chosen soup option id when the item required a soup; null otherwise.'
  })
  soupOptionId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Display name of the chosen soup; null when no soup was required.'
  })
  soupName!: string | null;
}

export class PaymentSnapshotDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  provider!: string;

  @ApiProperty({ type: String })
  providerReference!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: Number })
  expectedAmountKobo!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  paidAmountKobo!: number | null;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  initializedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  verifiedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  paidAt!: string | null;
}

export class OrderDetailDto extends OrderSummaryDto {
  @ApiProperty({ isArray: true, type: () => OrderItemDto })
  items!: OrderItemDto[];

  @ApiPropertyOptional({ nullable: true, type: () => PaymentSnapshotDto })
  latestPayment!: PaymentSnapshotDto | null;
}

export class OrderPaymentStatusDto {
  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ enum: orderStatuses, type: String })
  orderStatus!: string;

  @ApiPropertyOptional({ nullable: true, type: () => PaymentSnapshotDto })
  payment!: PaymentSnapshotDto | null;
}

export class DeliveryConfirmationDto {
  @ApiProperty({ format: 'uuid', type: String })
  confirmationId!: string;
}

export class OrderQuoteEnvelopeDto {
  @ApiProperty({ type: () => OrderQuoteDto })
  data!: OrderQuoteDto;
}

export class CreatedOrderEnvelopeDto {
  @ApiProperty({ type: () => CreatedOrderDto })
  data!: CreatedOrderDto;
}

export class OrderListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => OrderSummaryDto })
  data!: OrderSummaryDto[];
}

export class OrderDetailEnvelopeDto {
  @ApiProperty({ type: () => OrderDetailDto })
  data!: OrderDetailDto;
}

export class OrderPaymentStatusEnvelopeDto {
  @ApiProperty({ type: () => OrderPaymentStatusDto })
  data!: OrderPaymentStatusDto;
}

export class DeliveryConfirmationEnvelopeDto {
  @ApiProperty({ type: () => DeliveryConfirmationDto })
  data!: DeliveryConfirmationDto;
}
