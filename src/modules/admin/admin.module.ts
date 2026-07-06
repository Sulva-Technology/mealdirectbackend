import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SettlementsModule } from '../settlements/settlements.module.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, SettlementsModule],
  controllers: [AdminController],
  providers: [AdminRepository, AdminService, AuditService],
  exports: [AdminService]
})
export class AdminModule {}
