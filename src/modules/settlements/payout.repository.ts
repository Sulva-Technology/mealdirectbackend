import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type {
  PayoutContext,
  PayoutGuardrails,
  PayoutRepositoryContract,
  PayoutTransferListItem,
  PayoutTransferPage,
  PayoutTransferRecord,
  RecordTransferInput
} from './payout.types.js';

const transferColumns = sql`
  id::text as "id",
  settlement_id::text as "settlementId",
  reference,
  amount_kobo as "amountKobo",
  provider_transfer_code as "providerTransferCode",
  status,
  attempt
`;

type KeysetCursor = { ts: string; id: string };

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

@Injectable()
export class PayoutRepository implements PayoutRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  // The idempotency guard: a settlement with an in-flight (pending) or completed (success)
  // transfer must never be paid again. Failed/reversed rows do not block a retry.
  async findActiveTransfer(settlementId: string): Promise<PayoutTransferRecord | undefined> {
    const result = await sql<PayoutTransferRecord>`
      select ${transferColumns}
      from public.payout_transfers
      where settlement_id = ${settlementId}::uuid
        and status in ('pending', 'success')
      order by attempt desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findPayoutContext(settlementId: string): Promise<PayoutContext | undefined> {
    const result = await sql<PayoutContext>`
      select
        s.id::text as "settlementId",
        s.payable_kobo as "payableKobo",
        coalesce(
          vpa.paystack_recipient_code,
          rpa.paystack_recipient_code,
          r.paystack_recipient_code
        ) as "recipientCode"
      from public.settlements s
      left join public.vendor_payout_accounts vpa
        on vpa.vendor_id = s.vendor_id and vpa.active
      left join public.rider_payout_accounts rpa
        on rpa.rider_id = s.rider_id and rpa.active
      left join public.riders r on r.id = s.rider_id
      where s.id = ${settlementId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async nextAttempt(settlementId: string): Promise<number> {
    const result = await sql<{ next: number }>`
      select coalesce(max(attempt), 0) + 1 as "next"
      from public.payout_transfers
      where settlement_id = ${settlementId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.next ?? 1;
  }

  async recordTransfer(input: RecordTransferInput): Promise<PayoutTransferRecord> {
    const result = await sql<PayoutTransferRecord>`
      insert into public.payout_transfers (
        settlement_id,
        attempt,
        reference,
        amount_kobo,
        provider_transfer_code,
        status,
        initiated_by,
        provider_payload
      )
      values (
        ${input.settlementId}::uuid,
        ${input.attempt},
        ${input.reference},
        ${input.amountKobo},
        ${input.providerTransferCode},
        ${input.status},
        ${input.initiatedBy}::uuid,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (settlement_id, attempt) do nothing
      returning ${transferColumns}
    `.execute(this.database.db);

    const inserted = result.rows[0];
    if (inserted !== undefined) {
      return inserted;
    }

    // A racing pay-run inserted this (settlement, attempt) first — return the row it wrote.
    const existing = await sql<PayoutTransferRecord>`
      select ${transferColumns}
      from public.payout_transfers
      where settlement_id = ${input.settlementId}::uuid and attempt = ${input.attempt}
      limit 1
    `.execute(this.database.db);

    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error('Payout transfer could not be recorded or retrieved.');
    }
    return row;
  }

  async getPayoutGuardrails(): Promise<PayoutGuardrails> {
    const result = await sql<PayoutGuardrails>`
      select
        public.platform_setting_int('payout_hold_hours', 24) as "holdHours",
        public.platform_setting_int('payout_max_attempts', 3) as "maxAttempts"
    `.execute(this.database.db);

    return result.rows[0] ?? { holdHours: 24, maxAttempts: 3 };
  }

  async selectPayableSettlements(
    guardrails: PayoutGuardrails,
    limit: number
  ): Promise<string[]> {
    const result = await sql<{ settlementId: string }>`
      select settlement_id::text as "settlementId"
      from public.select_payable_settlements(
        ${guardrails.holdHours},
        ${guardrails.maxAttempts},
        ${limit}
      )
    `.execute(this.database.db);

    return result.rows.map((row) => row.settlementId);
  }

  async listPendingTransfers(
    graceSeconds: number,
    limit: number
  ): Promise<Array<{ id: string; reference: string }>> {
    const result = await sql<{ id: string; reference: string }>`
      select id::text as "id", reference
      from public.payout_transfers
      where status = 'pending'
        and created_at <= now() - make_interval(secs => ${graceSeconds})
      order by created_at
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  async applyReconcile(
    reference: string,
    status: 'success' | 'failed' | 'reversed',
    payload: Record<string, unknown>
  ): Promise<void> {
    await sql`
      select public.reconcile_payout_transfer(
        ${reference},
        ${status},
        ${JSON.stringify(payload)}::jsonb
      )
    `.execute(this.database.db);
  }

  // Admin queue. needs_admin is derived (spec: "max failed attempts reached and no success"),
  // computed here so no extra write is needed. A `status = 'needs_admin'` filter maps onto it.
  async listTransfers(input: {
    status?: string;
    maxAttempts: number;
    limit: number;
    cursor?: string;
  }): Promise<PayoutTransferPage> {
    const cursor = decodeKeysetCursor(input.cursor);
    const wantsNeedsAdmin = input.status === 'needs_admin';
    const statusFilter = wantsNeedsAdmin ? undefined : input.status;

    const rows = await sql<PayoutTransferListItem>`
      with ranked as (
        select
          pt.id,
          pt.settlement_id,
          pt.reference,
          pt.amount_kobo,
          pt.provider_transfer_code,
          pt.status,
          pt.attempt,
          pt.created_at,
          (
            not exists (
              select 1 from public.payout_transfers s
              where s.settlement_id = pt.settlement_id and s.status = 'success'
            )
            and (
              select count(*) from public.payout_transfers f
              where f.settlement_id = pt.settlement_id and f.status in ('failed', 'reversed')
            ) >= ${input.maxAttempts}
            and pt.attempt = (
              select max(a.attempt) from public.payout_transfers a
              where a.settlement_id = pt.settlement_id
            )
          ) as needs_admin
        from public.payout_transfers pt
      )
      select
        id::text as "id",
        settlement_id::text as "settlementId",
        reference,
        amount_kobo as "amountKobo",
        provider_transfer_code as "providerTransferCode",
        status,
        attempt,
        needs_admin as "needsAdmin",
        created_at::text as "createdAt"
      from ranked
      where (${statusFilter ?? null}::text is null or status = ${statusFilter ?? null})
        and (${wantsNeedsAdmin} is false or needs_admin is true)
        and (
          ${cursor === undefined}
          or (created_at, id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by created_at desc, id desc
      limit ${input.limit + 1}
    `.execute(this.database.db);

    const hasMore = rows.rows.length > input.limit;
    const items = rows.rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      limit: input.limit,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor({ ts: last.createdAt, id: last.id }) }
        : {})
    };
  }

  async findTransferById(id: string): Promise<PayoutTransferListItem | undefined> {
    const result = await sql<PayoutTransferListItem>`
      select
        pt.id::text as "id",
        pt.settlement_id::text as "settlementId",
        pt.reference,
        pt.amount_kobo as "amountKobo",
        pt.provider_transfer_code as "providerTransferCode",
        pt.status,
        pt.attempt,
        (
          not exists (
            select 1 from public.payout_transfers s
            where s.settlement_id = pt.settlement_id and s.status = 'success'
          )
          and (
            select count(*) from public.payout_transfers f
            where f.settlement_id = pt.settlement_id and f.status in ('failed', 'reversed')
          ) >= public.platform_setting_int('payout_max_attempts', 3)
          and pt.attempt = (
            select max(a.attempt) from public.payout_transfers a
            where a.settlement_id = pt.settlement_id
          )
        ) as "needsAdmin",
        pt.created_at::text as "createdAt"
      from public.payout_transfers pt
      where pt.id = ${id}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }
}
