import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';

function normalizeCode(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class RedeemReferralDto {
  @ApiProperty({
    description: 'Referral code to redeem. Case-insensitive; 8 Crockford base32 characters.',
    example: 'K7M2QX9A',
    pattern: '^[0-9A-HJ-NP-TV-Z]{8}$',
    type: String
  })
  @Transform(({ value }) => normalizeCode(value))
  @Matches(/^[0-9A-HJ-NP-TV-Z]{8}$/, {
    message: 'code must be a valid 8-character referral code.'
  })
  code!: string;
}

export class ReferralAnalyticsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  campusId?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
