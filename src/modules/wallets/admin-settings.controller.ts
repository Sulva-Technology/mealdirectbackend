import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
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
import { PlatformSettingUpdateDto } from './dto/admin-wallet.dto.js';
import type { PlatformSettingRecord } from './wallets.types.js';

@ApiTags('admin-settings')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role and the admin:manage permission are required.' })
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminSettingsController {
  constructor(@Inject(AdminWalletsService) private readonly wallets: AdminWalletsService) {}

  @Get()
  @RequirePermission('admin:manage')
  @ApiOkResponse({
    description: 'All platform settings. Wallet limits today, fee splits in slice B.'
  })
  async listSettings(): Promise<ListEnvelope<PlatformSettingRecord>> {
    const settings = await this.wallets.listSettings();
    return createListEnvelope(settings, { hasMore: false, limit: settings.length });
  }

  @Patch()
  @RequirePermission('admin:manage')
  @ApiOkResponse({ description: 'Updates one editable platform setting. Audited.' })
  async updateSetting(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: PlatformSettingUpdateDto
  ): Promise<SuccessEnvelope<PlatformSettingRecord>> {
    return createSuccessEnvelope(await this.wallets.updateSetting(actor, body.key, body.value));
  }
}
