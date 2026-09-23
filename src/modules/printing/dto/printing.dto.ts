import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';
import {
  paperWidths,
  printJobKinds,
  printJobStatuses,
  type PaperWidth,
  type PrintJobKind,
  type PrintJobStatus
} from '../printing.types.js';

export class PrinterIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  printerId!: string;
}

export class PrintOrderIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  orderId!: string;
}

export class RegisterPrinterDto {
  @ApiProperty({ example: 'Kitchen printer', maxLength: 80, minLength: 1, type: String })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({
    description:
      'Printer MAC address as printed on its self-test page. Any of 00:11:62:AA:BB:CC, 00-11-62-aa-bb-cc, 001162AABBCC.',
    example: '00:11:62:AA:BB:CC',
    type: String
  })
  @IsString()
  @Length(12, 17)
  macAddress!: string;

  @ApiPropertyOptional({
    default: 48,
    description: 'Characters per line: 32 for 58mm paper, 42 or 48 for 80mm.',
    enum: paperWidths,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(paperWidths)
  paperWidthChars?: PaperWidth;
}

export class PrintJobListQueryDto {
  @ApiPropertyOptional({ enum: printJobStatuses, type: String })
  @IsOptional()
  @IsIn(printJobStatuses)
  status?: PrintJobStatus;

  @ApiPropertyOptional({ default: 50, maximum: 200, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class VendorPrinterDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ example: '00:11:62:aa:bb:cc', type: String })
  macAddress!: string;

  @ApiProperty({ enum: paperWidths, type: Number })
  paperWidthChars!: PaperWidth;

  @ApiProperty({ nullable: true, type: String })
  lastSeenAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastStatusCode!: string | null;

  @ApiProperty({ description: 'Polled within the last 2 minutes.', type: Boolean })
  online!: boolean;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class PrinterRegistrationDto {
  @ApiProperty({ type: VendorPrinterDto })
  printer!: VendorPrinterDto;

  @ApiProperty({
    description:
      "Paste into the printer's CloudPRNT Server URL setting. Shown only once — rotate the key to get a new one.",
    type: String
  })
  serverUrl!: string;
}

export class PrintJobDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  vendorId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  orderNumber!: string | null;

  @ApiProperty({ enum: printJobKinds, type: String })
  kind!: PrintJobKind;

  @ApiProperty({ enum: printJobStatuses, type: String })
  status!: PrintJobStatus;

  @ApiProperty({ type: String })
  printAfter!: string;

  @ApiProperty({ type: Number })
  attempts!: number;

  @ApiProperty({ nullable: true, type: String })
  printedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastError!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class ReceiptItemDto {
  @ApiProperty({ type: String })
  itemName!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  unitPriceKobo!: number;

  @ApiProperty({ type: Number })
  lineTotalKobo!: number;

  @ApiProperty({ type: String })
  unitType!: string;

  @ApiProperty({ nullable: true, type: String })
  soupName!: string | null;

  @ApiProperty({ additionalProperties: true, type: 'object' })
  customization!: Record<string, unknown>;
}

export class ReceiptDto {
  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ type: String })
  orderNumber!: string;

  @ApiProperty({ type: String })
  vendorDisplayName!: string;

  @ApiProperty({ example: '2026-09-23', type: String })
  serviceDate!: string;

  @ApiProperty({ example: '13:00', type: String })
  deliveryTime!: string;

  @ApiProperty({ type: String })
  deliverySlotName!: string;

  @ApiProperty({ example: 'Africa/Lagos', type: String })
  campusTimezone!: string;

  @ApiProperty({ type: String })
  customerName!: string;

  @ApiProperty({ nullable: true, type: String })
  customerPhone!: string | null;

  @ApiProperty({ type: String })
  locationName!: string;

  @ApiProperty({ nullable: true, type: String })
  roomNumber!: string | null;

  @ApiProperty({ type: String })
  deliveryMode!: string;

  @ApiProperty({ nullable: true, type: String })
  specialInstructions!: string | null;

  @ApiProperty({
    description: 'Food subtotal only — excludes delivery, service fee and surcharge.',
    type: Number
  })
  foodSubtotalKobo!: number;

  @ApiProperty({ nullable: true, type: String })
  paidAt!: string | null;

  @ApiProperty({ type: [ReceiptItemDto] })
  items!: ReceiptItemDto[];
}

export class ReceiptViewDto {
  @ApiProperty({ type: ReceiptDto })
  receipt!: ReceiptDto;

  @ApiProperty({ description: 'The ticket exactly as printed (48-column preview).', type: String })
  text!: string;
}

export class VendorPrinterEnvelopeDto {
  @ApiProperty({ type: VendorPrinterDto })
  data!: VendorPrinterDto;
}

export class VendorPrinterListEnvelopeDto {
  @ApiProperty({ type: [VendorPrinterDto] })
  data!: VendorPrinterDto[];
}

export class PrinterRegistrationEnvelopeDto {
  @ApiProperty({ type: PrinterRegistrationDto })
  data!: PrinterRegistrationDto;
}

export class PrintJobEnvelopeDto {
  @ApiProperty({ type: PrintJobDto })
  data!: PrintJobDto;
}

export class PrintJobListEnvelopeDto {
  @ApiProperty({ type: [PrintJobDto] })
  data!: PrintJobDto[];
}

export class ReceiptViewEnvelopeDto {
  @ApiProperty({ type: ReceiptViewDto })
  data!: ReceiptViewDto;
}

export class CloudPrntPollResponseDto {
  @ApiProperty({ type: Boolean })
  jobReady!: boolean;

  @ApiPropertyOptional({ example: ['text/plain'], type: [String] })
  mediaTypes?: string[];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  jobToken?: string;
}
