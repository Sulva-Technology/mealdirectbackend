import { Module } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { CloudPrntController } from './cloudprnt.controller.js';
import { CloudPrntService } from './cloudprnt.service.js';
import { PrintingRepository } from './printing.repository.js';
import { PrintingService } from './printing.service.js';
import { VendorPrintersController } from './vendor-printers.controller.js';

@Module({
  imports: [AuthModule, FeatureFlagsModule],
  controllers: [VendorPrintersController, CloudPrntController],
  providers: [AuditService, PrintingRepository, PrintingService, CloudPrntService]
})
export class PrintingModule {}
