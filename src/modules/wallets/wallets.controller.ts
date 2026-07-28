import { Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { CursorPaginationQueryDto } from '../../common/dto/api-contract.dto.js';
import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  DedicatedAccountEnvelopeDto,
  WalletEnvelopeDto,
  WalletLedgerListEnvelopeDto
} from './dto/wallet.dto.js';
import { WalletsService } from './wallets.service.js';
import type {
  CustomerWalletView,
  DedicatedAccountRecord,
  WalletLedgerEntryRecord
} from './wallets.types.js';

@ApiTags('wallet')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Only customers hold wallets.' })
@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('customer')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Wallet balance, advisory limits and the dedicated account when provisioned.',
    type: WalletEnvelopeDto
  })
  async getWallet(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<CustomerWalletView>> {
    return createSuccessEnvelope(await this.wallets.getWallet(actor));
  }

  @Get('ledger')
  @ApiOkResponse({
    description: 'Keyset-paginated wallet movements, newest first.',
    type: WalletLedgerListEnvelopeDto
  })
  async listLedger(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: CursorPaginationQueryDto
  ): Promise<ListEnvelope<WalletLedgerEntryRecord>> {
    const page = await this.wallets.listLedger(actor, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Post('dedicated-account')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Idempotently provisions or retries the customer dedicated bank account.',
    type: DedicatedAccountEnvelopeDto
  })
  async requestDedicatedAccount(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<DedicatedAccountRecord>> {
    return createSuccessEnvelope(await this.wallets.requestDedicatedAccount(actor));
  }
}
