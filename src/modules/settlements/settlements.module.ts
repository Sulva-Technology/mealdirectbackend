import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsRepository } from './settlements.repository.js';
import { SettlementsService } from './settlements.service.js';
import { VendorSettlementsController } from './vendor-settlements.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SettlementsController, VendorSettlementsController],
  providers: [SettlementsRepository, SettlementsService]
})
export class SettlementsModule {}
