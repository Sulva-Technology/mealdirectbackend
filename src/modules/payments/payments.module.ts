import { Module } from '@nestjs/common';

import { PaystackWebhookController } from './paystack-webhook.controller.js';
import { PaystackWebhookService } from './paystack-webhook.service.js';

@Module({
  controllers: [PaystackWebhookController],
  providers: [PaystackWebhookService]
})
export class PaymentsModule {}
