import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { VendorsController } from './vendors.controller.js';
import { VendorsRepository } from './vendors.repository.js';
import { VendorsService } from './vendors.service.js';
import { VendorOrdersController } from './vendor-orders.controller.js';
import { VendorOrdersService } from './vendor-orders.service.js';
import { VendorOrdersRepository } from './vendor-orders.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [VendorsController, VendorOrdersController],
  providers: [VendorsRepository, VendorsService, VendorOrdersRepository, VendorOrdersService],
  exports: [VendorsService, VendorOrdersService]
})
export class VendorsModule {}
