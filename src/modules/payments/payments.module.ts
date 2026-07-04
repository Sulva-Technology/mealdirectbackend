import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CustomerPaymentsController, AdminPaymentsController } from './payments.controller.js';
import { AdminHealthController } from './admin-health.controller.js';
import { AdminWebhooksController } from './admin-webhooks.controller.js';
import { AdminProblemQueuesController } from './admin-problem-queues.controller.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsRepository } from './refunds.repository.js';
import { RefundsService } from './refunds.service.js';
import { PaystackWebhookController } from './paystack-webhook.controller.js';
import { PaystackWebhookService } from './paystack-webhook.service.js';
import { PaystackClient } from './paystack.client.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationRepository } from './reconciliation.repository.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    CustomerPaymentsController,
    AdminPaymentsController,
    AdminHealthController,
    AdminWebhooksController,
    AdminProblemQueuesController,
    PaystackWebhookController,
    ReconciliationController,
    RefundsController
  ],
  providers: [
    AuditService,
    PaystackClient,
    PaymentsRepository,
    PaymentsService,
    PaystackWebhookService,
    ReconciliationRepository,
    ReconciliationService,
    RefundsRepository,
    RefundsService
  ],
  exports: [PaymentsService]
})
export class PaymentsModule {}
