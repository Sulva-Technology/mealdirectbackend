import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const outboxStatuses = ['available', 'failed', 'locked', 'processed'] as const;

export class OutboxListQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: outboxStatuses, type: String })
  @IsOptional()
  @IsIn(outboxStatuses)
  status?: (typeof outboxStatuses)[number];

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  eventType?: string;
}

export class ProcessOutboxDto {
  @ApiPropertyOptional({ default: 10, maximum: 50, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  workerId?: string;
}
