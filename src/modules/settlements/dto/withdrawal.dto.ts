import { ApiProperty } from '@nestjs/swagger';

export class WithdrawalBalanceDto {
  @ApiProperty({
    description:
      'Earnings past the hold, net of refunds, that a withdrawal pays now. Negative when refunds exceed earnings.',
    type: Number
  })
  availableKobo!: number;

  @ApiProperty({ description: 'Delivered earnings still inside the hold window.', type: Number })
  pendingKobo!: number;

  @ApiProperty({ description: 'Withdrawals sent and awaiting bank confirmation.', type: Number })
  processingKobo!: number;

  @ApiProperty({ example: 100000, type: Number })
  minimumKobo!: number;

  @ApiProperty({ example: 120, type: Number })
  holdMinutes!: number;

  @ApiProperty({ description: 'An admin-approved payout bank account is on file.', type: Boolean })
  payoutAccountReady!: boolean;

  @ApiProperty({ description: 'On-demand withdrawals are switched on.', type: Boolean })
  enabled!: boolean;

  @ApiProperty({ description: 'A withdrawal request would succeed right now.', type: Boolean })
  canWithdraw!: boolean;
}

export class WithdrawalResultDto {
  @ApiProperty({
    format: 'uuid',
    description: 'On-demand settlement created for this withdrawal.',
    type: String
  })
  settlementId!: string;

  @ApiProperty({ type: Number })
  amountKobo!: number;

  @ApiProperty({
    enum: ['pending', 'success', 'processing'],
    description:
      'pending: Paystack accepted the transfer; success: paid; processing: being confirmed, completes automatically.',
    type: String
  })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  reference!: string | null;
}

export class WithdrawalBalanceEnvelopeDto {
  @ApiProperty({ type: () => WithdrawalBalanceDto })
  data!: WithdrawalBalanceDto;
}

export class WithdrawalResultEnvelopeDto {
  @ApiProperty({ type: () => WithdrawalResultDto })
  data!: WithdrawalResultDto;
}
