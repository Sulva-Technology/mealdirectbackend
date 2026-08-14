import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type { WalletStatus } from '../../domain/wallet.js';
import type {
  AdminWalletRecord,
  DedicatedAccountRecord,
  DedicatedAccountUpsert,
  WalletLedgerEntryRecord,
  WalletPage,
  WalletRecord,
  WalletsRepositoryContract
} from './wallets.types.js';

type KeysetCursor = { ts: string; id: string };

// Same {ts,id} base64url payload the admin lists already emit (AdminRepository.toList),
// so a cursor is interchangeable across the admin API surface.
function decodeKeysetCursor(cursor?: string): KeysetCursor | undefined {
  if (cursor === undefined || cursor.length === 0) return undefined;
  try {
    const payload = decodeCursor(cursor);
    if (typeof payload.ts === 'string' && typeof payload.id === 'string') {
      return { ts: payload.ts, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  tsOf: (row: T) => string
): WalletPage<T> {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    hasMore,
    limit,
    ...(hasMore && last !== undefined
      ? { nextCursor: encodeCursor({ ts: tsOf(last), id: last.id }) }
      : {})
  };
}

@Injectable()
export class WalletsRepository implements WalletsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensureWallet(userId: string): Promise<string> {
    const result = await sql<{ walletId: string }>`
      select public.ensure_customer_wallet(${userId}::uuid)::text as "walletId"
    `.execute(this.database.db);

    const walletId = result.rows[0]?.walletId;
    if (walletId === undefined) {
      throw new Error('Wallet provisioning did not return a wallet ID.');
    }
    return walletId;
  }

  async findWalletByUserId(userId: string): Promise<WalletRecord | undefined> {
    const result = await sql<WalletRecord>`
      ${this.walletSelect()}
      where w.user_id = ${userId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findWalletById(walletId: string): Promise<WalletRecord | undefined> {
    const result = await sql<WalletRecord>`
      ${this.walletSelect()}
      where w.id = ${walletId}::uuid
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findDedicatedAccount(walletId: string): Promise<DedicatedAccountRecord | null> {
    const result = await sql<DedicatedAccountRecord>`
      select
        account_number as "accountNumber",
        account_name as "accountName",
        bank_name as "bankName",
        bank_slug as "bankSlug",
        status::text as "status"
      from public.wallet_dedicated_accounts
      where wallet_id = ${walletId}::uuid
    `.execute(this.database.db);

    return result.rows[0] ?? null;
  }

  async listLedgerEntries(
    walletId: string,
    pagination: { cursor?: string; limit: number }
  ): Promise<WalletPage<WalletLedgerEntryRecord>> {
    const cursor = decodeKeysetCursor(pagination.cursor);
    const result = await sql<WalletLedgerEntryRecord>`
      select
        e.id::text as "id",
        e.entry_type::text as "entryType",
        e.amount_kobo as "amountKobo",
        e.balance_after_kobo as "balanceAfterKobo",
        e.order_id::text as "orderId",
        o.order_number as "orderNumber",
        e.provider_reference as "providerReference",
        e.reason,
        e.created_at::text as "createdAt"
      from public.wallet_ledger_entries e
      left join public.orders o on o.id = e.order_id
      where e.wallet_id = ${walletId}::uuid
        and (
          ${cursor?.ts ?? null}::timestamptz is null
          or (e.created_at, e.id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by e.created_at desc, e.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    return toPage(result.rows, pagination.limit, (row) => row.createdAt);
  }

  async listWallets(
    pagination: { cursor?: string; limit: number },
    maxBalanceKobo: number
  ): Promise<WalletPage<AdminWalletRecord>> {
    const cursor = decodeKeysetCursor(pagination.cursor);
    // Over-cap wallets sort first: they are the ones an admin must act on. Within each
    // group the ordering is the standard (created_at, id) desc keyset.
    const result = await sql<AdminWalletRecord>`
      select
        w.id::text as "id",
        w.user_id::text as "userId",
        w.balance_kobo as "balanceKobo",
        w.currency,
        w.status::text as "status",
        w.created_at::text as "createdAt",
        w.updated_at::text as "updatedAt",
        p.email::text as "userEmail",
        p.display_name as "userDisplayName",
        da.account_number as "accountNumber",
        (w.balance_kobo > ${maxBalanceKobo}) as "overCap"
      from public.wallets w
      left join public.profiles p on p.id = w.user_id
      left join public.wallet_dedicated_accounts da on da.wallet_id = w.id
      where (
        ${cursor?.ts ?? null}::timestamptz is null
        or (w.created_at, w.id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
      )
      order by (w.balance_kobo > ${maxBalanceKobo}) desc, w.created_at desc, w.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    return toPage(result.rows, pagination.limit, (row) => row.createdAt);
  }

  async adjustWallet(
    walletId: string,
    amountKobo: number,
    reason: string,
    actorUserId: string
  ): Promise<WalletRecord> {
    await sql`
      select public.admin_adjust_wallet(
        ${walletId}::uuid,
        ${amountKobo}::integer,
        ${reason},
        ${actorUserId}::uuid
      )
    `.execute(this.database.db);

    return this.requireWallet(walletId);
  }

  async setWalletStatus(walletId: string, status: WalletStatus): Promise<WalletRecord> {
    await sql`
      select public.set_wallet_status(${walletId}::uuid, ${status}::public.wallet_status)
    `.execute(this.database.db);

    return this.requireWallet(walletId);
  }

  async upsertDedicatedAccount(input: DedicatedAccountUpsert): Promise<DedicatedAccountRecord> {
    const result = await sql<DedicatedAccountRecord>`
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
      returning
        account_number as "accountNumber",
        account_name as "accountName",
        bank_name as "bankName",
        bank_slug as "bankSlug",
        status::text as "status"
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Dedicated account upsert did not return a row.');
    }
    return row;
  }

  async listWalletIdsMissingDedicatedAccount(
    limit: number
  ): Promise<{ walletId: string; userId: string }[]> {
    const result = await sql<{ walletId: string; userId: string }>`
      select w.id::text as "walletId", w.user_id::text as "userId"
      from public.wallets w
      left join public.wallet_dedicated_accounts da on da.wallet_id = w.id
      where da.id is null
      order by w.created_at
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  private async requireWallet(walletId: string): Promise<WalletRecord> {
    const wallet = await this.findWalletById(walletId);
    if (wallet === undefined) {
      throw new Error(`Wallet ${walletId} disappeared during the operation.`);
    }
    return wallet;
  }

  private walletSelect() {
    return sql`
      select
        w.id::text as "id",
        w.user_id::text as "userId",
        w.balance_kobo as "balanceKobo",
        w.currency,
        w.status::text as "status",
        w.created_at::text as "createdAt",
        w.updated_at::text as "updatedAt"
      from public.wallets w
    `;
  }
}
