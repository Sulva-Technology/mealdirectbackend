import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PaystackClient } from '../payments/paystack.client.js';
import { AdminUnitTypesController } from './admin-unit-types.controller.js';
import { AdminVendorMenuController } from './admin-vendor-menu.controller.js';
import { VendorsController } from './vendors.controller.js';
import { VendorsRepository } from './vendors.repository.js';
import { VendorsService } from './vendors.service.js';
import { VendorOrdersController } from './vendor-orders.controller.js';
import { VendorOrdersService } from './vendor-orders.service.js';
import { VendorOrdersRepository } from './vendor-orders.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [
    VendorsController,
    VendorOrdersController,
    AdminUnitTypesController,
    AdminVendorMenuController
  ],
  providers: [
    VendorsRepository,
    VendorsService,
    VendorOrdersRepository,
    VendorOrdersService,
    PaystackClient
  ],
  exports: [VendorsService, VendorOrdersService]
})
export class VendorsModule {}
