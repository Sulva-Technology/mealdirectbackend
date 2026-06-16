import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { maxCursorLimit } from '../api/pagination.js';
import { IsDatabaseUuid } from '../validation.js';

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor returned by the previous page.',
    example: 'eyJpZCI6Im9yZGVyLTEifQ',
    type: String
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    default: 20,
    maximum: maxCursorLimit,
    minimum: 1,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxCursorLimit)
  limit?: number;
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 lower bound for date filtering.',
    example: '2026-06-15T00:00:00.000Z',
    type: String
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 upper bound for date filtering.',
    example: '2026-06-16T00:00:00.000Z',
    type: String
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;
}

export class UuidParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  id!: string;
}

export class MoneyDto {
  @ApiProperty({
    description: 'Amount in the smallest currency unit.',
    example: 250000,
    minimum: 0,
    type: Number
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents!: number;

  @ApiProperty({
    description: 'ISO-4217 uppercase currency code.',
    example: 'NGN',
    pattern: '^[A-Z]{3}$',
    type: String
  })
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class SortQueryDto {
  @ApiPropertyOptional({
    description: 'Sort expression in field:direction form, or -field for descending.',
    example: 'createdAt:desc',
    type: String
  })
  @IsOptional()
  @IsString()
  sort?: string;
}

export class StatusQueryDto {
  @ApiPropertyOptional({ description: 'Module-specific status filter.', type: String })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CursorPaginationMetaDto {
  @ApiProperty({ description: 'True when another page is available.', type: Boolean })
  hasMore!: boolean;

  @ApiProperty({ description: 'Limit applied to the current page.', minimum: 1, type: Number })
  limit!: number;

  @ApiPropertyOptional({ description: 'Cursor to request the next page.', type: String })
  nextCursor?: string;
}

export class SuccessEnvelopeDto {
  @ApiProperty({ description: 'Response payload.', type: Object })
  data!: unknown;

  @ApiPropertyOptional({ description: 'Optional response metadata.', type: Object })
  meta?: Record<string, unknown>;
}

export class ListEnvelopeDto {
  @ApiProperty({ description: 'Response list payload.', isArray: true, type: Object })
  data!: unknown[];

  @ApiProperty({ type: () => CursorPaginationMetaDto })
  pagination!: CursorPaginationMetaDto;

  @ApiPropertyOptional({ description: 'Optional response metadata.', type: Object })
  meta?: Record<string, unknown>;
}

export class ErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_FAILED', type: String })
  code!: string;

  @ApiProperty({ example: 'Request validation failed', type: String })
  message!: string;

  @ApiPropertyOptional({
    description: 'Request identifier for support and log correlation.',
    type: String
  })
  requestId?: string;

  @ApiPropertyOptional({
    description: 'Safe machine-readable error details.',
    isArray: true,
    type: Object
  })
  details?: Record<string, unknown>[];
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: () => ErrorBodyDto })
  error!: ErrorBodyDto;
}

export function createStatusDto<TStatus extends readonly [string, ...string[]]>(
  statuses: TStatus
): new () => { status?: TStatus[number] } {
  class GeneratedStatusDto {
    @IsOptional()
    @IsIn(statuses)
    status?: TStatus[number];
  }

  return GeneratedStatusDto;
}
