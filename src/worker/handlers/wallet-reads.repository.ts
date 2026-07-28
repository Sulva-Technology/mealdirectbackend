import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { DedicatedAccountStatus } from '../../domain/wallet.js';

export type WalletOwner = {
  walletId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
};

export type DedicatedAccountWrite = {
  walletId: string;
  paystackCustomerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string;
  status: DedicatedAccountStatus;
  providerPayload: Record<string, unknown>;
};

@Injectable()
export class WalletReadsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findWalletOwner(walletId: string): Promise<WalletOwner | undefined> {
    const result = await sql<WalletOwner>`
      select
        w.id::text as "walletId",
        w.user_id::text as "userId",
        p.email::text as "email",
        p.display_name as "displayName"
      from public.wallets w
      left join public.profiles p on p.id = w.user_id
      where w.id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findDedicatedAccount(walletId: string): Promise<{ status: DedicatedAccountStatus } | null> {
    const result = await sql<{ status: DedicatedAccountStatus }>`
      select status::text as "status"
      from public.wallet_dedicated_accounts
      where wallet_id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0] ?? null;
  }

  async upsertDedicatedAccount(input: DedicatedAccountWrite): Promise<void> {
    await sql`
      insert into public.wallet_dedicated_accounts (
        wallet_id, paystack_customer_code, account_number, account_name,
        bank_name, bank_slug, status, provider_payload
      )
      values (
        ${input.walletId}::uuid,
        ${input.paystackCustomerCode},
        ${input.accountNumber},
        ${input.accountName},
        ${input.bankName},
        ${input.bankSlug},
        ${input.status}::public.dva_status,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (wallet_id) do update
      set paystack_customer_code = excluded.paystack_customer_code,
          account_number = excluded.account_number,
          account_name = excluded.account_name,
          bank_name = excluded.bank_name,
          bank_slug = excluded.bank_slug,
          status = excluded.status,
          provider_payload = excluded.provider_payload,
          updated_at = now()
    `.execute(this.database.db);
  }
}
