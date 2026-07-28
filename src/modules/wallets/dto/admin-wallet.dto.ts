import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CursorPaginationQueryDto } from '../../../common/dto/api-contract.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

export class WalletIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  walletId!: string;
}

export class AdminWalletListQueryDto extends CursorPaginationQueryDto {}

export class WalletAdjustDto {
  @ApiProperty({
    description:
      'Signed adjustment in kobo. Positive credits the wallet, negative debits it. Must not be zero.',
    example: 100000,
    type: Number
  })
  @Type(() => Number)
  @IsInt()
  amountKobo!: number;

  @ApiProperty({
    description: 'Why the adjustment was made. Mandatory — it appears in the audit log.',
    maxLength: 500,
    minLength: 1,
    type: String
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class WalletFreezeDto {
  @ApiProperty({
    description: 'True freezes the wallet (no order payments, credits still land). False unfreezes.',
    type: Boolean
  })
  @IsBoolean()
  frozen!: boolean;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

const editableSettingKeys = ['wallet_min_topup_kobo', 'wallet_max_balance_kobo'] as const;

export class PlatformSettingUpdateDto {
  @ApiProperty({ enum: editableSettingKeys, type: String })
  @IsIn(editableSettingKeys)
  key!: (typeof editableSettingKeys)[number];

  @ApiProperty({ description: 'Non-negative whole number of kobo.', example: 5000000, type: Number })
  @Type(() => Number)
  @IsInt()
  value!: number;
}
