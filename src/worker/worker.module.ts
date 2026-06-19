import { Module } from '@nestjs/common';

import { LoggingModule } from '../common/logging/logging.module.js';
import { EnvModule } from '../config/env.module.js';
import { EnvService } from '../config/env.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { DeviceTokensRepository } from '../modules/notifications/device-tokens.repository.js';
import { EmailChannel } from '../notifications/channels/email.channel.js';
import { PushChannel } from '../notifications/channels/push.channel.js';
import { HandlerRegistry } from './handler-registry.js';
import { NotificationDispatchHandler } from './handlers/notification-dispatch.handler.js';
import { NotificationReadsRepository } from './handlers/notification-reads.repository.js';
import { OutboxProcessor } from './outbox-processor.js';
import { OutboxRepository } from './outbox.repository.js';
import { createEmailTransport, createPushSender } from './transports.js';

@Module({
  imports: [EnvModule, DatabaseModule, LoggingModule],
  providers: [
    OutboxRepository,
    NotificationReadsRepository,
    DeviceTokensRepository,
    {
      provide: EmailChannel,
      useFactory: (env: EnvService): EmailChannel =>
        new EmailChannel(createEmailTransport(env.all), env.get('EMAIL_FROM')),
      inject: [EnvService]
    },
    {
      provide: PushChannel,
      useFactory: (env: EnvService, tokens: DeviceTokensRepository): PushChannel =>
        new PushChannel(createPushSender(env.all), tokens),
      inject: [EnvService, DeviceTokensRepository]
    },
    {
      provide: NotificationDispatchHandler,
      useFactory: (
        reads: NotificationReadsRepository,
        email: EmailChannel,
        push: PushChannel
      ): NotificationDispatchHandler => new NotificationDispatchHandler(reads, email, push),
      inject: [NotificationReadsRepository, EmailChannel, PushChannel]
    },
    {
      provide: HandlerRegistry,
      useFactory: (dispatch: NotificationDispatchHandler): HandlerRegistry => {
        const registry = new HandlerRegistry();
        for (const prefix of ['order.', 'payment.', 'settlement.']) {
          registry.registerPrefix(prefix, dispatch.handle);
        }
        return registry;
      },
      inject: [NotificationDispatchHandler]
    },
    {
      provide: OutboxProcessor,
      useFactory: (
        repository: OutboxRepository,
        registry: HandlerRegistry,
        env: EnvService
      ): OutboxProcessor =>
        new OutboxProcessor(repository, registry, {
          batchSize: env.get('WORKER_BATCH_SIZE'),
          maxAttempts: env.get('WORKER_MAX_ATTEMPTS')
        }),
      inject: [OutboxRepository, HandlerRegistry, EnvService]
    }
  ],
  exports: [OutboxProcessor]
})
export class WorkerModule {}
