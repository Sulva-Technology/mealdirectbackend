import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PayoutTransferQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'success', 'failed', 'reversed', 'needs_admin'] })
  @IsOptional()
  @IsIn(['pending', 'success', 'failed', 'reversed', 'needs_admin'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
