import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaystackClient } from '../payments/paystack.client.js';
import { RidersController } from './riders.controller.js';
import { RidersRepository } from './riders.repository.js';
import { RidersService } from './riders.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RidersController],
  providers: [RidersRepository, RidersService, PaystackClient, AuditService],
  exports: [RidersService]
})
export class RidersModule {}
