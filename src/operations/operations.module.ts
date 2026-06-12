import { Module } from '@nestjs/common';

import { MetricsService } from '../common/observability/metrics.service.js';
import { OperationsController } from './operations.controller.js';
import { InternalOperationsGuard } from './internal-operations.guard.js';

@Module({
  controllers: [OperationsController],
  providers: [InternalOperationsGuard, MetricsService],
  exports: [MetricsService]
})
export class OperationsModule {}
