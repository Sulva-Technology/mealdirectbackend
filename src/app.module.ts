import { Module } from '@nestjs/common';

import { LoggingModule } from './common/logging/logging.module.js';
import { EnvModule } from './config/env.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { capabilityModules } from './modules/capability-modules.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    EnvModule,
    LoggingModule,
    DatabaseModule,
    HealthModule,
    OperationsModule,
    ...capabilityModules
  ]
})
export class AppModule {}
