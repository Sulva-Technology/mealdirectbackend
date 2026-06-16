import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDatabaseUuid } from '../../../common/validation.js';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateEscalationDto {
  @ApiProperty({ maxLength: 80, minLength: 1, type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @ApiProperty({ maxLength: 2000, minLength: 10, type: String })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;
}

export class EscalationRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  orderId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  openedBy!: string;

  @ApiProperty({ type: String })
  category!: string;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ enum: ['open', 'investigating', 'resolved', 'rejected'], type: String })
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  assignedAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolution!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  refundId!: string | null;

  @ApiProperty({ type: String })
  openedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolvedAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class EscalationEnvelopeDto {
  @ApiProperty({ type: () => EscalationRecordDto })
  data!: EscalationRecordDto;
}

export class EscalationListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => EscalationRecordDto })
  data!: EscalationRecordDto[];
}
