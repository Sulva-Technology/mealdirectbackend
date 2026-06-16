import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { VendorBatchesController } from './vendor-batches.controller.js';
import { BatchesService } from './batches.service.js';
import { BatchesRepository } from './batches.repository.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VendorBatchesController],
  providers: [BatchesRepository, BatchesService],
  exports: [BatchesService]
})
export class BatchesModule {}
