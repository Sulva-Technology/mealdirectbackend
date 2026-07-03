import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { allowedImageContentTypes } from '../storage.constants.js';

// Hard ceiling for the declared size; per-surface caps are enforced in MediaService.
const MAX_DECLARED_BYTES = 10 * 1024 * 1024;

export class UploadUrlRequestDto {
  @ApiProperty({ enum: allowedImageContentTypes, type: String })
  @IsIn(allowedImageContentTypes)
  contentType!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_DECLARED_BYTES, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DECLARED_BYTES)
  sizeBytes!: number;
}

export class ConfirmUploadDto {
  @ApiProperty({
    type: String,
    description: 'Owner-scoped Storage key returned by the matching upload-url endpoint.'
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  key!: string;
}

export class UploadUrlResponseDto {
  @ApiProperty({ type: String, description: 'Signed URL the client PUTs the binary to.' })
  uploadUrl!: string;

  @ApiProperty({ type: String, description: 'Signed upload token.' })
  token!: string;

  @ApiProperty({ type: String, description: 'Owner-scoped Storage key to confirm afterwards.' })
  key!: string;
}

export class UploadUrlEnvelopeDto {
  @ApiProperty({ type: () => UploadUrlResponseDto })
  data!: UploadUrlResponseDto;
}
