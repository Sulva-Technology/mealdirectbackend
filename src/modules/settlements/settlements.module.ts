import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PaystackClient } from '../payments/paystack.client.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsRepository } from './settlements.repository.js';
import { SettlementsService } from './settlements.service.js';
import { VendorSettlementsController } from './vendor-settlements.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SettlementsController, VendorSettlementsController],
  providers: [
    SettlementsRepository,
    SettlementsService,
    PayoutRepository,
    PayoutService,
    PaystackClient
  ],
  exports: [PayoutService]
})
export class SettlementsModule {}
