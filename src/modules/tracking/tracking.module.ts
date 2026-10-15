import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import {
  AdminMapController,
  FleetMapController,
  OrderTrackingController,
  RiderTrackingController
} from './tracking.controller.js';
import { TrackingRepository } from './tracking.repository.js';
import { TrackingService } from './tracking.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, FleetModule],
  controllers: [
    RiderTrackingController,
    OrderTrackingController,
    AdminMapController,
    FleetMapController
  ],
  providers: [TrackingRepository, TrackingService]
})
export class TrackingModule {}
