import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import {
  AdminCampusDirectoryController,
  PublicCampusDirectoryController
} from './campus-directory.controller.js';
import { CampusDirectoryRepository } from './campus-directory.repository.js';
import { CampusDirectoryService } from './campus-directory.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PublicCampusDirectoryController, AdminCampusDirectoryController],
  providers: [CampusDirectoryRepository, CampusDirectoryService],
  exports: [CampusDirectoryService]
})
export class CampusesModule {}
