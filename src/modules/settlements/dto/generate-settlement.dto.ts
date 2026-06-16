import { Matches } from 'class-validator';
import { IsDatabaseUuid } from '../../../common/validation.js';

export class GenerateSettlementDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  settlementDate!: string;
}

export class VendorSettlementParamsDto {
  @IsDatabaseUuid()
  vendorId!: string;
}

export class RiderSettlementParamsDto {
  @IsDatabaseUuid()
  riderId!: string;
}
