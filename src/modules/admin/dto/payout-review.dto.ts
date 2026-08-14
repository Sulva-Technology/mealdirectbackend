import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class PayoutAccountReviewDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'pending'] })
  @IsIn(['approved', 'rejected', 'pending'])
  status!: 'approved' | 'rejected' | 'pending';

  @ApiPropertyOptional({ description: 'Reason recorded when rejecting or flagging an account.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;
}
