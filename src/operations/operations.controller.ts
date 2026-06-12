import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { MetricsService } from '../common/observability/metrics.service.js';
import { EnvService } from '../config/env.service.js';
import { DatabaseService } from '../database/database.service.js';
import { InternalOperationsGuard } from './internal-operations.guard.js';

@ApiTags('operations')
@ApiBearerAuth('operationsToken')
@Controller('operations')
@UseGuards(InternalOperationsGuard)
export class OperationsController {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetricsService) private readonly metrics: MetricsService
  ) {}

  @Get('status')
  @ApiOkResponse({ description: 'Internal operational status for authorized administrators.' })
  @ApiUnauthorizedResponse({ description: 'Operations token missing or invalid.' })
  status(): Record<string, unknown> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      release: {
        version: this.env.get('RELEASE_VERSION'),
        commitSha: this.env.get('COMMIT_SHA')
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage()
      },
      database: {
        pool: this.database.getPoolStats()
      },
      metrics: this.metrics.snapshot()
    };
  }
}
