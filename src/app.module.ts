import { Module } from '@nestjs/common';

import { LoggingModule } from './common/logging/logging.module.js';
import { EnvModule } from './config/env.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { capabilityModules } from './modules/capability-modules.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { WorkerModule } from './worker/worker.module.js';

@Module({
  imports: [
    EnvModule,
    LoggingModule,
    DatabaseModule,
    StorageModule,
    HealthModule,
    OperationsModule,
    // Provides OutboxProcessor so the API can drain the outbox inline
    // (Render free tier has no separate worker service). The drain loop is
    // started only from src/main.ts, so tests using createApp never drain.
    WorkerModule,
    ...capabilityModules
  ]
})
export class AppModule {}
