import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AnalyticsAdminController } from './analytics.admin.controller.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, AnalyticsAdminController],
  providers: [AnalyticsRepository, AnalyticsService]
})
export class AnalyticsModule {}
