import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

import {
  dedicatedAccountStatuses,
  walletEntryTypes,
  walletStatuses
} from '../../../domain/wallet.js';

export class DedicatedAccountDto {
  @ApiProperty({ example: '9900001111', type: String })
  accountNumber!: string;

  @ApiProperty({ example: 'MEALDIRECT / ADA LOVELACE', type: String })
  accountName!: string;

  @ApiProperty({ example: 'Wema Bank', type: String })
  bankName!: string;

  @ApiProperty({ example: 'wema-bank', type: String })
  bankSlug!: string;

  @ApiProperty({ enum: dedicatedAccountStatuses, type: String })
  status!: (typeof dedicatedAccountStatuses)[number];
}

export class WalletDto {
  @ApiProperty({ description: 'Spendable balance in kobo.', example: 250000, type: Number })
  balanceKobo!: number;

  @ApiProperty({ example: 'NGN', type: String })
  currency!: string;

  @ApiProperty({ enum: walletStatuses, type: String })
  status!: (typeof walletStatuses)[number];

  @ApiProperty({
    description:
      'Advisory minimum top-up in kobo. UI guidance only — an inbound transfer below this is still credited in full.',
    example: 50000,
    type: Number
  })
  minTopupKobo!: number;

  @ApiProperty({
    description:
      'Advisory maximum balance in kobo. A credit crossing it is still applied and raises an admin flag.',
    example: 5000000,
    type: Number
  })
  maxBalanceKobo!: number;

  @ApiPropertyOptional({
    description:
      'The customer dedicated bank account, or null while WALLET_DVA_ENABLED is off or provisioning is pending.',
    nullable: true,
    type: () => DedicatedAccountDto
  })
  dedicatedAccount!: DedicatedAccountDto | null;
}

export class WalletEnvelopeDto {
  @ApiProperty({ type: () => WalletDto })
  data!: WalletDto;
}

export class DedicatedAccountEnvelopeDto {
  @ApiProperty({ type: () => DedicatedAccountDto })
  data!: DedicatedAccountDto;
}

export class WalletLedgerEntryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: walletEntryTypes, type: String })
  entryType!: (typeof walletEntryTypes)[number];

  @ApiProperty({
    description: 'Signed movement in kobo: credits positive, debits negative.',
    example: -45000,
    type: Number
  })
  amountKobo!: number;

  @ApiProperty({ example: 205000, type: Number })
  balanceAfterKobo!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiPropertyOptional({ example: 'MD-0104', nullable: true, type: String })
  orderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  providerReference!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;
}

export class WalletLedgerListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => WalletLedgerEntryDto })
  data!: WalletLedgerEntryDto[];

  @ApiProperty({
    example: { hasMore: true, limit: 20, nextCursor: 'eyJ0cyI6IjIwMjYtMDctMjciLCJpZCI6Ii4uLiJ9' },
    type: Object
  })
  pagination!: Record<string, unknown>;
}

export class WalletTopupDto {
  @ApiProperty({
    description:
      'Amount to add in kobo. Must meet the minimum top-up and stay within the balance limit.',
    example: 500000,
    minimum: 100,
    type: Number
  })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(100_000_000)
  amountKobo!: number;
}

export class WalletTopupCheckoutDto {
  @ApiProperty({ example: 'WTU-0b6c9b1e-4d2f-4c55-9a7e-8f5d2a1c3b4e', type: String })
  reference!: string;

  @ApiProperty({
    description: 'Paystack checkout URL. Redirect the customer here to pay.',
    example: 'https://checkout.paystack.com/abc123',
    type: String
  })
  authorizationUrl!: string;

  @ApiProperty({ type: String })
  accessCode!: string;

  @ApiProperty({ example: 500000, type: Number })
  amountKobo!: number;
}

export class WalletTopupCheckoutEnvelopeDto {
  @ApiProperty({ type: () => WalletTopupCheckoutDto })
  data!: WalletTopupCheckoutDto;
}
