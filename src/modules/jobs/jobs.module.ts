import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsRepository } from './jobs.repository.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [JobsController],
  providers: [JobsRepository, JobsService],
  exports: [JobsService]
})
export class JobsModule {}
