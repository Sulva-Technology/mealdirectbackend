import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminFleetPartnersController,
  FleetController,
  RiderFleetController
} from './fleet.controller.js';
import { FleetRepository } from './fleet.repository.js';
import { FleetService } from './fleet.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AdminFleetPartnersController, FleetController, RiderFleetController],
  providers: [FleetRepository, FleetService, AuditService],
  exports: [FleetService]
})
export class FleetModule {}
