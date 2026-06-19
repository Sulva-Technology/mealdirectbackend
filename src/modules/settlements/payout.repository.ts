import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  PayoutContext,
  PayoutRepositoryContract,
  PayoutTransferRecord,
  RecordTransferInput
} from './payout.types.js';

@Injectable()
export class PayoutRepository implements PayoutRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findTransferBySettlement(settlementId: string): Promise<PayoutTransferRecord | undefined> {
    const result = await sql<PayoutTransferRecord>`
      select
        id::text as "id",
        settlement_id::text as "settlementId",
        reference,
        amount_kobo as "amountKobo",
        provider_transfer_code as "providerTransferCode",
        status
      from public.payout_transfers
      where settlement_id = ${settlementId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findPayoutContext(settlementId: string): Promise<PayoutContext | undefined> {
    const result = await sql<PayoutContext>`
      select
        s.id::text as "settlementId",
        s.payable_kobo as "payableKobo",
        case when s.vendor_id is not null then 'vendor' else 'rider' end as "beneficiary",
        case
          when s.vendor_id is not null then vpa.id::text
          else r.id::text
        end as "beneficiaryRefId",
        coalesce(vpa.paystack_recipient_code, r.paystack_recipient_code) as "recipientCode",
        coalesce(vpa.account_name, r.display_name) as "accountName",
        coalesce(vpa.masked_account_number, '') as "accountNumber",
        coalesce(vpa.bank_code, '') as "bankCode",
        'NGN' as "currency"
      from public.settlements s
      left join public.vendor_payout_accounts vpa
        on vpa.vendor_id = s.vendor_id and vpa.active
      left join public.riders r on r.id = s.rider_id
      where s.id = ${settlementId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async saveRecipientCode(context: PayoutContext, recipientCode: string): Promise<void> {
    if (context.beneficiary === 'vendor') {
      await sql`
        update public.vendor_payout_accounts
        set paystack_recipient_code = ${recipientCode}
        where id = ${context.beneficiaryRefId}::uuid
      `.execute(this.database.db);
      return;
    }

    await sql`
      update public.riders
      set paystack_recipient_code = ${recipientCode}
      where id = ${context.beneficiaryRefId}::uuid
    `.execute(this.database.db);
  }

  async recordTransfer(input: RecordTransferInput): Promise<PayoutTransferRecord> {
    const result = await sql<PayoutTransferRecord>`
      insert into public.payout_transfers (
        settlement_id,
        reference,
        amount_kobo,
        provider_transfer_code,
        status,
        initiated_by,
        provider_payload
      )
      values (
        ${input.settlementId}::uuid,
        ${input.reference},
        ${input.amountKobo},
        ${input.providerTransferCode},
        ${input.status},
        ${input.initiatedBy}::uuid,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (settlement_id) do nothing
      returning
        id::text as "id",
        settlement_id::text as "settlementId",
        reference,
        amount_kobo as "amountKobo",
        provider_transfer_code as "providerTransferCode",
        status
    `.execute(this.database.db);

    const inserted = result.rows[0];
    if (inserted !== undefined) {
      return inserted;
    }

    const existing = await this.findTransferBySettlement(input.settlementId);
    if (existing === undefined) {
      throw new Error('Payout transfer could not be recorded or retrieved.');
    }
    return existing;
  }
}
