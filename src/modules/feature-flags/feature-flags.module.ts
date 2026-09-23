import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminFeatureFlagsController,
  MyFeatureFlagsController
} from './feature-flags.controller.js';
import { FeatureFlagsRepository } from './feature-flags.repository.js';
import { FeatureFlagsService } from './feature-flags.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminFeatureFlagsController, MyFeatureFlagsController],
  providers: [AuditService, FeatureFlagsRepository, FeatureFlagsService],
  exports: [FeatureFlagsService]
})
export class FeatureFlagsModule {}
