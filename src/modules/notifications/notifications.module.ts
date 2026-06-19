import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DeviceTokensController } from './device-tokens.controller.js';
import { DeviceTokensRepository } from './device-tokens.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, DeviceTokensController],
  providers: [NotificationsRepository, NotificationsService, DeviceTokensRepository]
})
export class NotificationsModule {}
