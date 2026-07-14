import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { SupportNotesService } from '../../common/support-notes/support-notes.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { SettlementsModule } from '../settlements/settlements.module.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, SettlementsModule, ChatModule],
  controllers: [AdminController],
  providers: [AdminRepository, AdminService, AuditService, SupportNotesService],
  exports: [AdminService]
})
export class AdminModule {}
