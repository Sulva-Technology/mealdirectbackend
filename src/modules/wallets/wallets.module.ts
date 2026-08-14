import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminWalletsController } from './admin-wallets.controller.js';
import { AdminWalletsService } from './admin-wallets.service.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsRepository } from './wallets.repository.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WalletsController, AdminWalletsController, AdminSettingsController],
  providers: [
    AuditService,
    PlatformSettingsRepository,
    WalletsRepository,
    WalletsService,
    AdminWalletsService
  ],
  exports: [WalletsRepository, PlatformSettingsRepository]
})
export class WalletsModule {}
