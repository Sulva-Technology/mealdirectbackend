import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CustomerPaymentsController, AdminPaymentsController } from './payments.controller.js';
import { PaystackWebhookController } from './paystack-webhook.controller.js';
import { PaystackWebhookService } from './paystack-webhook.service.js';
import { PaystackClient } from './paystack.client.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerPaymentsController, AdminPaymentsController, PaystackWebhookController],
  providers: [PaystackClient, PaymentsRepository, PaymentsService, PaystackWebhookService],
  exports: [PaymentsService]
})
export class PaymentsModule {}
