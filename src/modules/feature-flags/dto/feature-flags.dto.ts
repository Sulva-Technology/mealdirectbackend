import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';
import {
  featureFlagModes,
  featureTesterSubjectTypes,
  type FeatureFlagMode,
  type FeatureTesterSubjectType
} from '../feature-flags.types.js';

export class FeatureFlagKeyParamDto {
  @ApiProperty({ example: 'cloud_printing', type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  key!: string;
}

export class UpdateFeatureFlagDto {
  @ApiProperty({
    description: 'off = nobody, test = feature testers only, on = everyone.',
    enum: featureFlagModes,
    type: String
  })
  @IsIn(featureFlagModes)
  mode!: FeatureFlagMode;
}

export class FeatureTesterIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  testerId!: string;
}

export class AddFeatureTesterDto {
  @ApiProperty({ enum: featureTesterSubjectTypes, type: String })
  @IsIn(featureTesterSubjectTypes)
  subjectType!: FeatureTesterSubjectType;

  @ApiProperty({
    description: 'profiles.id for subjectType user, vendors.id for subjectType vendor.',
    format: 'uuid',
    type: String
  })
  @IsDatabaseUuid()
  subjectId!: string;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class FeatureFlagDto {
  @ApiProperty({ type: String })
  key!: string;

  @ApiProperty({ enum: featureFlagModes, type: String })
  mode!: FeatureFlagMode;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class FeatureTesterDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: featureTesterSubjectTypes, type: String })
  subjectType!: FeatureTesterSubjectType;

  @ApiProperty({ format: 'uuid', type: String })
  subjectId!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class FeatureFlagEnvelopeDto {
  @ApiProperty({ type: FeatureFlagDto })
  data!: FeatureFlagDto;
}

export class FeatureFlagListEnvelopeDto {
  @ApiProperty({ type: [FeatureFlagDto] })
  data!: FeatureFlagDto[];
}

export class FeatureTesterEnvelopeDto {
  @ApiProperty({ type: FeatureTesterDto })
  data!: FeatureTesterDto;
}

export class FeatureTesterListEnvelopeDto {
  @ApiProperty({ type: [FeatureTesterDto] })
  data!: FeatureTesterDto[];
}

export class MyFeatureFlagsEnvelopeDto {
  @ApiProperty({
    additionalProperties: { type: 'boolean' },
    description: 'Flag key → enabled for the caller.',
    example: { cloud_printing: true },
    type: 'object'
  })
  data!: Record<string, boolean>;
}
