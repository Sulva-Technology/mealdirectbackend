import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AdminPromotionsController, PromotionsController } from './promotions.controller.js';
import { PromotionsRepository } from './promotions.repository.js';
import { PromotionsService } from './promotions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromotionsRepository, PromotionsService]
})
export class PromotionsModule {}
