import { Module } from '@nestjs/common';

import { JsonLogger } from './common/logging/json-logger.service.js';
import { EnvModule } from './config/env.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { capabilityModules } from './modules/capability-modules.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [EnvModule, DatabaseModule, HealthModule, OperationsModule, ...capabilityModules],
  providers: [JsonLogger]
})
export class AppModule {}
