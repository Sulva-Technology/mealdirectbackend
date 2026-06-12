import { IsUUID, Matches } from 'class-validator';

export class GenerateSettlementDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  settlementDate!: string;
}

export class VendorSettlementParamsDto {
  @IsUUID()
  vendorId!: string;
}

export class RiderSettlementParamsDto {
  @IsUUID()
  riderId!: string;
}
