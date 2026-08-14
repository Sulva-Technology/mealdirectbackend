import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { AdminWalletsService } from './admin-wallets.service.js';
import {
  AdminWalletListQueryDto,
  WalletAdjustDto,
  WalletFreezeDto,
  WalletIdParamDto
} from './dto/admin-wallet.dto.js';
import { WalletLedgerListEnvelopeDto } from './dto/wallet.dto.js';
import type { AdminWalletRecord, WalletLedgerEntryRecord, WalletRecord } from './wallets.types.js';

@ApiTags('admin-wallets')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role and the wallets:manage permission are required.' })
@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminWalletsController {
  constructor(@Inject(AdminWalletsService) private readonly wallets: AdminWalletsService) {}

  @Get()
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Wallets, over-cap balances first.' })
  async listWallets(
    @Query() query: AdminWalletListQueryDto
  ): Promise<ListEnvelope<AdminWalletRecord>> {
    const page = await this.wallets.listWallets({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Get(':walletId/ledger')
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Ledger for one wallet.', type: WalletLedgerListEnvelopeDto })
  async listLedger(
    @Param() params: WalletIdParamDto,
    @Query() query: AdminWalletListQueryDto
  ): Promise<ListEnvelope<WalletLedgerEntryRecord>> {
    const page = await this.wallets.listLedger(params.walletId, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Post(':walletId/adjust')
  @HttpCode(200)
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Signed manual adjustment. Requires a reason and is audited.' })
  async adjustWallet(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: WalletIdParamDto,
    @Body() body: WalletAdjustDto
  ): Promise<SuccessEnvelope<WalletRecord>> {
    return createSuccessEnvelope(
      await this.wallets.adjustWallet(actor, params.walletId, {
        amountKobo: body.amountKobo,
        reason: body.reason
      })
    );
  }

  @Post(':walletId/freeze')
  @HttpCode(200)
  @RequirePermission('wallets:manage')
  @ApiOkResponse({ description: 'Freezes or unfreezes a wallet.' })
  async freezeWallet(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: WalletIdParamDto,
    @Body() body: WalletFreezeDto
  ): Promise<SuccessEnvelope<WalletRecord>> {
    return createSuccessEnvelope(
      await this.wallets.setStatus(
        actor,
        params.walletId,
        body.frozen ? 'frozen' : 'active',
        body.reason
      )
    );
  }
}
