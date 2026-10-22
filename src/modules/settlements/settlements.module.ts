import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PaystackClient } from '../payments/paystack.client.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsRepository } from './settlements.repository.js';
import { SettlementsService } from './settlements.service.js';
import { VendorSettlementsController } from './vendor-settlements.controller.js';
import {
  RiderWithdrawalsController,
  VendorWithdrawalsController
} from './withdrawals.controller.js';
import { WithdrawalsRepository } from './withdrawals.repository.js';
import { WithdrawalsService } from './withdrawals.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    SettlementsController,
    VendorSettlementsController,
    VendorWithdrawalsController,
    RiderWithdrawalsController
  ],
  providers: [
    SettlementsRepository,
    SettlementsService,
    PayoutRepository,
    PayoutService,
    PaystackClient,
    WithdrawalsRepository,
    WithdrawalsService
  ],
  exports: [PayoutService]
})
export class SettlementsModule {}
