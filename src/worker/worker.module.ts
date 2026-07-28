import { Module } from '@nestjs/common';

import { LoggingModule } from '../common/logging/logging.module.js';
import { EnvModule } from '../config/env.module.js';
import { EnvService } from '../config/env.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { DeviceTokensRepository } from '../modules/notifications/device-tokens.repository.js';
import { EmailChannel } from '../notifications/channels/email.channel.js';
import { PushChannel } from '../notifications/channels/push.channel.js';
import { PaystackClient } from '../modules/payments/paystack.client.js';
import { HandlerRegistry, NOTIFICATION_EVENT_PREFIXES } from './handler-registry.js';
import { AutoDispatchHandler } from './handlers/auto-dispatch.handler.js';
import { DispatchReadsRepository } from './handlers/dispatch-reads.repository.js';
import { NotificationDispatchHandler } from './handlers/notification-dispatch.handler.js';
import { NotificationReadsRepository } from './handlers/notification-reads.repository.js';
import { WalletDvaHandler } from './handlers/wallet-dva.handler.js';
import { WalletReadsRepository } from './handlers/wallet-reads.repository.js';
import { OutboxProcessor } from './outbox-processor.js';
import { OutboxRepository } from './outbox.repository.js';
import { createEmailTransport, createPushSender } from './transports.js';

@Module({
  imports: [EnvModule, DatabaseModule, LoggingModule],
  providers: [
    OutboxRepository,
    NotificationReadsRepository,
    DispatchReadsRepository,
    DeviceTokensRepository,
    WalletReadsRepository,
    PaystackClient,
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
      provide: AutoDispatchHandler,
      useFactory: (reads: DispatchReadsRepository): AutoDispatchHandler =>
        new AutoDispatchHandler(reads),
      inject: [DispatchReadsRepository]
    },
    {
      provide: WalletDvaHandler,
      useFactory: (
        reads: WalletReadsRepository,
        paystack: PaystackClient,
        env: EnvService
      ): WalletDvaHandler => new WalletDvaHandler(reads, paystack, env.get('WALLET_DVA_ENABLED')),
      inject: [WalletReadsRepository, PaystackClient, EnvService]
    },
    {
      provide: HandlerRegistry,
      useFactory: (
        dispatch: NotificationDispatchHandler,
        autoDispatch: AutoDispatchHandler,
        walletDva: WalletDvaHandler
      ): HandlerRegistry => {
        const registry = new HandlerRegistry();
        for (const prefix of NOTIFICATION_EVENT_PREFIXES) {
          registry.registerPrefix(prefix, dispatch.handle);
        }
        registry.register('order.ready', autoDispatch.handle);
        registry.register('wallet.dva_requested', walletDva.handle);
        return registry;
      },
      inject: [NotificationDispatchHandler, AutoDispatchHandler, WalletDvaHandler]
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
