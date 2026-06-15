import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesRepository } from './profiles.repository.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfilesController],
  providers: [ProfilesRepository, ProfilesService],
  exports: [ProfilesService]
})
export class ProfilesModule {}
