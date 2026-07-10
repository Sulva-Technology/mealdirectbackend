import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type {
  AdminPaymentDetail,
  AdminPaymentListFilter,
  AdminPaymentListResult,
  AdminPaymentRecord,
  PaymentInitializationRecord,
  PaymentRecord,
  PaymentTimelineEvent,
  PaymentWebhookRecord,
  PaymentsRepositoryContract,
  RefundInput,
  RefundRecord,
  RefundStatus
} from './payments.types.js';

type OrderIdResult = {
  orderId: string;
};

type RefundedAmountResult = {
  refundedAmountKobo: string | number | null;
};

type PaymentCursor = { createdAt: string; id: string };

function toPaymentCursor(value: string): PaymentCursor | undefined {
  try {
    const payload = decodeCursor(value);
    if (typeof payload.createdAt === 'string' && typeof payload.id === 'string') {
      return { createdAt: payload.createdAt, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class PaymentsRepository implements PaymentsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findCustomerInitializationPayment(
    customerId: string,
    orderId: string
  ): Promise<PaymentInitializationRecord | undefined> {
    const result = await sql<PaymentInitializationRecord>`
      select
        p.id::text as "id",
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        pr.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.order_status::text as "orderStatus",
        o.total_kobo as "orderTotalKobo",
        p.provider_reference as "providerReference",
        p.status::text as "paymentStatus",
        p.expected_amount_kobo as "expectedAmountKobo",
        p.currency
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.profiles pr on pr.id = o.customer_id
      where o.id = ${orderId}::uuid
        and o.customer_id = ${customerId}::uuid
        and p.provider = 'paystack'::public.payment_provider
        and p.status in ('initialized', 'pending')
      order by p.created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findStuckPaystackPayments(
    staleSeconds: number,
    limit: number
  ): Promise<PaymentInitializationRecord[]> {
    const result = await sql<PaymentInitializationRecord>`
      select
        p.id::text as "id",
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        pr.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.order_status::text as "orderStatus",
        o.total_kobo as "orderTotalKobo",
        p.provider_reference as "providerReference",
        p.status::text as "paymentStatus",
        p.expected_amount_kobo as "expectedAmountKobo",
        p.currency
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.profiles pr on pr.id = o.customer_id
      where p.provider = 'paystack'::public.payment_provider
        and p.status in ('initialized', 'pending')
        -- Include expired orders: release_expired_reservations may flip an order to expired before
        -- the provider success lands. Re-verifying these lets mark_verified_payment_successful auto-
        -- recover them to paid, so a missed/late webhook can no longer strand a captured payment.
        and o.order_status in ('pending_payment'::public.order_status, 'expired'::public.order_status)
        and p.created_at < now() - make_interval(secs => ${staleSeconds})
        -- Upper age bound: a genuine late capture lands within minutes/hours, never days. Without
        -- this, unpaid expired orders (whose payment stays pending) would be re-polled against
        -- Paystack on every sweep forever.
        and p.created_at > now() - interval '48 hours'
      order by p.created_at asc
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  async markPaymentInitializationPayload(
    paymentId: string,
    providerPayload: Record<string, unknown>
  ): Promise<PaymentRecord> {
    const result = await sql<PaymentRecord>`
      update public.payments
      set status = 'pending',
          provider_payload = ${JSON.stringify(providerPayload)}::jsonb,
          updated_at = now()
      where id = ${paymentId}::uuid
      returning
        id::text as "id",
        order_id::text as "orderId",
        (select order_number from public.orders where id = order_id) as "orderNumber",
        (select customer_id::text from public.orders where id = order_id) as "customerId",
        (
          select pr.email::text
          from public.orders o
          join public.profiles pr on pr.id = o.customer_id
          where o.id = order_id
        ) as "customerEmail",
        (select campus_id::text from public.orders where id = order_id) as "campusId",
        (select order_status::text from public.orders where id = order_id) as "orderStatus",
        (select total_kobo from public.orders where id = order_id) as "orderTotalKobo",
        provider_reference as "providerReference",
        status::text as "paymentStatus",
        expected_amount_kobo as "expectedAmountKobo",
        paid_amount_kobo as "paidAmountKobo",
        provider_transaction_id as "providerTransactionId",
        currency,
        initialized_at::text as "initializedAt",
        verified_at::text as "verifiedAt",
        paid_at::text as "paidAt",
        provider_payload as "providerPayload"
    `.execute(this.database.db);

    const payment = result.rows[0];
    if (payment === undefined) {
      throw new Error('Payment initialization update did not return a payment row.');
    }
    return payment;
  }

  async listAdminPaymentsPaged(
    filter: AdminPaymentListFilter,
    pagination: { cursor?: string; limit: number },
    campusId?: string
  ): Promise<AdminPaymentListResult> {
    const cursor = pagination.cursor === undefined ? undefined : toPaymentCursor(pagination.cursor);
    const result = await sql<AdminPaymentRecord & { createdAt: string }>`
      select
        p.id::text as "id",
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        pr.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.order_status::text as "orderStatus",
        o.total_kobo as "orderTotalKobo",
        p.provider_reference as "providerReference",
        p.status::text as "paymentStatus",
        p.expected_amount_kobo as "expectedAmountKobo",
        p.paid_amount_kobo as "paidAmountKobo",
        p.provider_transaction_id as "providerTransactionId",
        p.currency,
        p.initialized_at::text as "initializedAt",
        p.verified_at::text as "verifiedAt",
        p.paid_at::text as "paidAt",
        p.created_at::text as "createdAt"
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.profiles pr on pr.id = o.customer_id
      where (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
        and (${filter.status ?? null}::public.payment_status is null
             or p.status = ${filter.status ?? null}::public.payment_status)
        and (${filter.vendorId ?? null}::uuid is null or o.vendor_id = ${filter.vendorId ?? null}::uuid)
        and (${filter.customerId ?? null}::uuid is null or o.customer_id = ${filter.customerId ?? null}::uuid)
        and (${filter.reference ?? null}::text is null
             or p.provider_reference ilike '%' || ${filter.reference ?? null}::text || '%'
             or o.order_number ilike '%' || ${filter.reference ?? null}::text || '%')
        and (${filter.dateFrom ?? null}::timestamptz is null or p.created_at >= ${filter.dateFrom ?? null}::timestamptz)
        and (${filter.dateTo ?? null}::timestamptz is null or p.created_at <= ${filter.dateTo ?? null}::timestamptz)
        and (
          ${cursor?.createdAt ?? null}::timestamptz is null
          or (p.created_at, p.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by p.created_at desc, p.id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    const rows = result.rows;
    const hasMore = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit).map(({ createdAt, ...rest }) => {
      void createdAt;
      return rest;
    });
    const lastRow = rows.slice(0, pagination.limit).at(-1);

    return {
      items,
      hasMore,
      limit: pagination.limit,
      ...(hasMore && lastRow !== undefined
        ? { nextCursor: encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id }) }
        : {})
    };
  }

  async getPaymentDetail(
    paymentId: string,
    campusId?: string
  ): Promise<AdminPaymentDetail | undefined> {
    const result = await sql<AdminPaymentDetail>`
      select
        p.id::text as "id",
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        pr.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.order_status::text as "orderStatus",
        o.total_kobo as "orderTotalKobo",
        p.provider_reference as "providerReference",
        p.status::text as "paymentStatus",
        p.expected_amount_kobo as "expectedAmountKobo",
        p.paid_amount_kobo as "paidAmountKobo",
        p.provider_transaction_id as "providerTransactionId",
        p.currency,
        p.initialized_at::text as "initializedAt",
        p.verified_at::text as "verifiedAt",
        p.paid_at::text as "paidAt",
        (exists (
          select 1 from public.payment_events pe
          where pe.provider_reference = p.provider_reference
        )) as "webhookReceived",
        (select count(*)::int from public.payment_events pe
          where pe.provider_reference = p.provider_reference) as "webhookCount",
        (case when p.verified_at is not null then 'verified' else 'unverified' end) as "verificationStatus",
        coalesce((
          select rf.status::text from public.refunds rf
          where rf.payment_id = p.id
          order by rf.requested_at desc limit 1
        ), 'none') as "refundStatus",
        coalesce((
          select sum(rf.amount_kobo)::int from public.refunds rf
          where rf.payment_id = p.id and rf.status not in ('failed', 'cancelled')
        ), 0) as "refundedAmountKobo",
        coalesce((
          select sum(sl.amount_kobo)::int from public.settlement_lines sl
          where sl.order_id = o.id
        ), 0) as "settlementImpactKobo"
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.profiles pr on pr.id = o.customer_id
      where p.id = ${paymentId}::uuid
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async getPaymentTimeline(paymentId: string): Promise<PaymentTimelineEvent[]> {
    const result = await sql<PaymentTimelineEvent>`
      with pay as (
        select id, order_id, provider_reference from public.payments where id = ${paymentId}::uuid
      )
      select osh.created_at::text as "at", 'order_status:' || osh.to_status::text as "type",
             'order'::text as "source",
             jsonb_build_object('fromStatus', osh.from_status, 'toStatus', osh.to_status, 'reason', osh.reason) as "detail"
      from public.order_status_history osh
      join pay on pay.order_id = osh.order_id
      union all
      select pe.received_at::text as "at", pe.event_type as "type",
             'payment_event'::text as "source",
             jsonb_build_object('signatureValid', pe.signature_valid, 'processingError', pe.processing_error) as "detail"
      from public.payment_events pe
      join pay on pay.provider_reference = pe.provider_reference
      union all
      select rf.requested_at::text as "at", 'refund:' || rf.status::text as "type",
             'refund'::text as "source",
             jsonb_build_object('amountKobo', rf.amount_kobo, 'reasonCode', rf.reason_code) as "detail"
      from public.refunds rf
      join pay on pay.id = rf.payment_id
      order by "at" asc
    `.execute(this.database.db);

    return result.rows;
  }

  async getPaymentWebhooks(providerReference: string): Promise<PaymentWebhookRecord[]> {
    const result = await sql<PaymentWebhookRecord>`
      select
        id::text as "id",
        event_type as "eventType",
        provider_reference as "providerReference",
        signature_valid as "signatureValid",
        received_at::text as "receivedAt",
        processed_at::text as "processedAt",
        processing_error as "processingError"
      from public.payment_events
      where provider_reference = ${providerReference}
      order by received_at asc
    `.execute(this.database.db);

    return result.rows;
  }

  async findAdminPaymentById(
    paymentId: string,
    campusId?: string
  ): Promise<PaymentRecord | undefined> {
    const result = await sql<PaymentRecord>`
      select
        p.id::text as "id",
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        o.customer_id::text as "customerId",
        pr.email::text as "customerEmail",
        o.campus_id::text as "campusId",
        o.order_status::text as "orderStatus",
        o.total_kobo as "orderTotalKobo",
        p.provider_reference as "providerReference",
        p.status::text as "paymentStatus",
        p.expected_amount_kobo as "expectedAmountKobo",
        p.paid_amount_kobo as "paidAmountKobo",
        p.provider_transaction_id as "providerTransactionId",
        p.currency,
        p.initialized_at::text as "initializedAt",
        p.verified_at::text as "verifiedAt",
        p.paid_at::text as "paidAt",
        p.provider_payload as "providerPayload"
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.profiles pr on pr.id = o.customer_id
      where p.id = ${paymentId}::uuid
        and (${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async markPaymentSuccessfulFromProvider(
    providerReference: string,
    providerTransactionId: string,
    paidAmountKobo: number,
    providerPayload: Record<string, unknown>
  ): Promise<string> {
    const result = await sql<OrderIdResult>`
      select public.mark_verified_payment_successful(
        'paystack'::public.payment_provider,
        ${providerReference},
        ${providerTransactionId},
        ${paidAmountKobo},
        ${JSON.stringify(providerPayload)}::jsonb
      )::text as "orderId"
    `.execute(this.database.db);

    const orderId = result.rows[0]?.orderId;
    if (orderId === undefined) {
      throw new Error('Payment reconciliation did not return an order ID.');
    }
    return orderId;
  }

  /**
   * Manual admin override: resolve a payment to successful WITHOUT a Paystack verification.
   * Used when the money is confirmed out-of-band (e.g. seen in the Paystack dashboard) but the
   * live reference is not verifiable from this environment (prod runs test keys). Reuses the same
   * mark_verified_payment_successful RPC so inventory booking, batch assignment and the order
   * expired/pending -> paid transition all fire identically. provider_transaction_id is left null
   * so a later real refund still falls back to the provider reference; the manual marker lives in
   * the provider_payload instead.
   */
  async forcePaymentPaidManual(
    providerReference: string,
    paidAmountKobo: number,
    providerPayload: Record<string, unknown>
  ): Promise<string> {
    const result = await sql<OrderIdResult>`
      select public.mark_verified_payment_successful(
        'paystack'::public.payment_provider,
        ${providerReference},
        ${null}::text,
        ${paidAmountKobo},
        ${JSON.stringify(providerPayload)}::jsonb
      )::text as "orderId"
    `.execute(this.database.db);

    const orderId = result.rows[0]?.orderId;
    if (orderId === undefined) {
      throw new Error('Manual payment override did not return an order ID.');
    }
    return orderId;
  }

  async getRefundedAmountKobo(paymentId: string): Promise<number> {
    const result = await sql<RefundedAmountResult>`
      select coalesce(sum(amount_kobo), 0) as "refundedAmountKobo"
      from public.refunds
      where payment_id = ${paymentId}::uuid
        and status not in ('failed')
    `.execute(this.database.db);

    const value = result.rows[0]?.refundedAmountKobo ?? 0;
    return typeof value === 'number' ? value : Number.parseInt(value, 10);
  }

  async createRefundRequest(
    paymentId: string,
    input: RefundInput,
    requestedBy: string
  ): Promise<RefundRecord> {
    const result = await sql<RefundRecord>`
      insert into public.refunds (
        payment_id,
        order_id,
        amount_kobo,
        reason_code,
        reason_text,
        requested_by
      )
      select
        p.id,
        p.order_id,
        ${input.amountKobo},
        ${input.reasonCode},
        ${input.reasonText ?? null},
        ${requestedBy}::uuid
      from public.payments p
      where p.id = ${paymentId}::uuid
      returning
        id::text as "id",
        payment_id::text as "paymentId",
        order_id::text as "orderId",
        provider_refund_reference as "providerRefundReference",
        amount_kobo as "amountKobo",
        reason_code as "reasonCode",
        reason_text as "reasonText",
        status::text as "status",
        requested_by::text as "requestedBy",
        requested_at::text as "requestedAt",
        processed_at::text as "processedAt"
    `.execute(this.database.db);

    const refund = result.rows[0];
    if (refund === undefined) {
      throw new Error('Refund request did not return a refund row.');
    }
    return refund;
  }

  async updateRefundProviderPayload(
    refundId: string,
    providerRefundReference: string,
    providerPayload: Record<string, unknown>,
    status: RefundStatus
  ): Promise<RefundRecord> {
    const result = await sql<RefundRecord>`
      update public.refunds
      set provider_refund_reference = ${providerRefundReference},
          provider_payload = ${JSON.stringify(providerPayload)}::jsonb,
          status = ${status}::public.refund_status,
          processed_at = case when ${status} = 'succeeded' then now() else processed_at end
      where id = ${refundId}::uuid
      returning
        id::text as "id",
        payment_id::text as "paymentId",
        order_id::text as "orderId",
        provider_refund_reference as "providerRefundReference",
        amount_kobo as "amountKobo",
        reason_code as "reasonCode",
        reason_text as "reasonText",
        status::text as "status",
        requested_by::text as "requestedBy",
        requested_at::text as "requestedAt",
        processed_at::text as "processedAt"
    `.execute(this.database.db);

    const refund = result.rows[0];
    if (refund === undefined) {
      throw new Error('Refund provider update did not return a refund row.');
    }
    return refund;
  }
}
