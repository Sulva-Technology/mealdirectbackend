import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService]
})
export class OrdersModule {}
