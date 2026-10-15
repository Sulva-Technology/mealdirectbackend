import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';

export class RiderLocationFixDto {
  @ApiProperty({ example: 7.6235, maximum: 90, minimum: -90, type: Number })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 5.2214, maximum: 180, minimum: -180, type: Number })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ description: 'Reported GPS accuracy radius in metres.', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;

  @ApiPropertyOptional({ description: 'Direction of travel, 0-359 degrees.', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(359)
  headingDegrees?: number;

  @ApiPropertyOptional({ description: 'Ground speed in metres per second.', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  speedMps?: number;

  @ApiPropertyOptional({
    description:
      'When the device took the fix (ISO 8601). Defaults to now. Fixes older than 15 minutes are ignored.',
    format: 'date-time',
    type: String
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  recordedAt?: string;
}

export class CoordinatesDto {
  @ApiProperty({ example: 7.6235, maximum: 90, minimum: -90, type: Number })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 5.2214, maximum: 180, minimum: -180, type: Number })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class TrackingAssignmentIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  assignmentId!: string;
}

export class TrackingOrderIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  orderId!: string;
}

export class MapCampusIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  campusId!: string;
}

export class MapLocationIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  locationId!: string;
}

export class MapVendorIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  vendorId!: string;
}

export class MapPartnerIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  partnerId!: string;
}

export class AdminRiderMapQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsDatabaseUuid()
  campusId?: string;
}
