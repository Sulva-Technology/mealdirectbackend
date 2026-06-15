import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { VendorsController } from './vendors.controller.js';
import { VendorsRepository } from './vendors.repository.js';
import { VendorsService } from './vendors.service.js';

@Module({
  imports: [AuthModule],
  controllers: [VendorsController],
  providers: [VendorsRepository, VendorsService],
  exports: [VendorsService]
})
export class VendorsModule {}
