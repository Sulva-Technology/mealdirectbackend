import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type { RefundStatus } from './payments.types.js';
import type {
  AdminRefundListFilter,
  AdminRefundListResult,
  AdminRefundRecord
} from './refunds.types.js';

const refundColumns = sql`
  r.id::text as "id",
  r.payment_id::text as "paymentId",
  r.order_id::text as "orderId",
  o.order_number as "orderNumber",
  o.campus_id::text as "campusId",
  o.vendor_id::text as "vendorId",
  o.customer_id::text as "customerId",
  cust.email::text as "customerEmail",
  p.provider_reference as "providerReference",
  p.provider_transaction_id as "providerTransactionId",
  r.provider_refund_reference as "providerRefundReference",
  r.amount_kobo as "amountKobo",
  r.reason_code as "reasonCode",
  r.reason_text as "reasonText",
  r.status::text as "status",
  r.failure_reason as "failureReason",
  r.resolution_note as "resolutionNote",
  r.requested_by::text as "requestedBy",
  r.resolved_by::text as "resolvedBy",
  r.requested_at::text as "requestedAt",
  r.processed_at::text as "processedAt",
  r.updated_at::text as "updatedAt"
`;

const refundJoins = sql`
  from public.refunds r
  join public.payments p on p.id = r.payment_id
  join public.orders o on o.id = r.order_id
  left join public.profiles cust on cust.id = o.customer_id
`;

type RefundCursor = { requestedAt: string; id: string };

function toCursor(value: string): RefundCursor | undefined {
  try {
    const payload = decodeCursor(value);
    if (typeof payload.requestedAt === 'string' && typeof payload.id === 'string') {
      return { requestedAt: payload.requestedAt, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class RefundsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listRefunds(
    filter: AdminRefundListFilter,
    pagination: { cursor?: string; limit: number },
    campusId?: string
  ): Promise<AdminRefundListResult> {
    const cursor = pagination.cursor === undefined ? undefined : toCursor(pagination.cursor);
    const result = await sql<AdminRefundRecord>`
      select ${refundColumns}
      ${refundJoins}
      where (${filter.status ?? null}::public.refund_status is null
             or r.status = ${filter.status ?? null}::public.refund_status)
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
        and (
          ${cursor?.requestedAt ?? null}::timestamptz is null
          or (r.requested_at, r.id) <
             (${cursor?.requestedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by r.requested_at desc, r.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    const rows = result.rows;
    const hasMore = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const last = items.at(-1);

    return {
      items,
      hasMore,
      limit: pagination.limit,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor({ requestedAt: last.requestedAt, id: last.id }) }
        : {})
    };
  }

  async findRefundById(
    refundId: string,
    campusId?: string
  ): Promise<AdminRefundRecord | undefined> {
    const result = await sql<AdminRefundRecord>`
      select ${refundColumns}
      ${refundJoins}
      where r.id = ${refundId}::uuid
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async applyProviderRetry(
    refundId: string,
    providerRefundReference: string,
    providerPayload: Record<string, unknown>,
    status: RefundStatus
  ): Promise<void> {
    await sql`
      update public.refunds
      set provider_refund_reference = ${providerRefundReference},
          provider_payload = ${JSON.stringify(providerPayload)}::jsonb,
          status = ${status}::public.refund_status,
          failure_reason = case when ${status} = 'failed' then failure_reason else null end,
          processed_at = case when ${status} = 'succeeded' then now() else processed_at end
      where id = ${refundId}::uuid
    `.execute(this.database.db);
  }

  async markResolution(
    refundId: string,
    status: RefundStatus,
    resolutionNote: string | undefined,
    failureReason: string | undefined,
    resolvedBy: string,
    campusId?: string
  ): Promise<AdminRefundRecord | undefined> {
    const updated = await sql<{ id: string }>`
      update public.refunds r
      set status = ${status}::public.refund_status,
          resolution_note = coalesce(${resolutionNote ?? null}, r.resolution_note),
          failure_reason = coalesce(${failureReason ?? null}, r.failure_reason),
          resolved_by = ${resolvedBy}::uuid,
          processed_at = case
            when ${status} in ('succeeded', 'failed', 'cancelled') then now()
            else r.processed_at
          end
      from public.orders o
      where r.id = ${refundId}::uuid
        and o.id = r.order_id
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      returning r.id::text as "id"
    `.execute(this.database.db);

    if (updated.rows[0] === undefined) return undefined;
    return this.findRefundById(refundId, campusId);
  }
}
