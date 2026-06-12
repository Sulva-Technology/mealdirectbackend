import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SettlementsController],
  providers: [SettlementsService]
})
export class SettlementsModule {}
