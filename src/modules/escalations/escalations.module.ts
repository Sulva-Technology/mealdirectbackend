import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CustomerEscalationsController } from './escalations.controller.js';
import { EscalationsRepository } from './escalations.repository.js';
import { EscalationsService } from './escalations.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerEscalationsController],
  providers: [EscalationsRepository, EscalationsService]
})
export class EscalationsModule {}
