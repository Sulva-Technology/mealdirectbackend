import { Module } from '@nestjs/common';

import { EnvService } from '../../config/env.service.js';
import { PushChannel } from '../../notifications/channels/push.channel.js';
import { createPushSender } from '../../worker/transports.js';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceTokensController } from './device-tokens.controller.js';
import { DeviceTokensRepository } from './device-tokens.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, DeviceTokensController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    DeviceTokensRepository,
    {
      provide: PushChannel,
      useFactory: (env: EnvService, tokens: DeviceTokensRepository): PushChannel =>
        new PushChannel(createPushSender(env.all), tokens),
      inject: [EnvService, DeviceTokensRepository]
    }
  ]
})
export class NotificationsModule {}
