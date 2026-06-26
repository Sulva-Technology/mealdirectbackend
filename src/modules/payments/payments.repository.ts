import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  PaymentInitializationRecord,
  PaymentRecord,
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
        and o.order_status = 'pending_payment'::public.order_status
        and p.created_at < now() - make_interval(secs => ${staleSeconds})
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

  async listAdminPayments(campusId?: string): Promise<PaymentRecord[]> {
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
      where ${campusId ?? null}::uuid is null or o.campus_id = ${campusId ?? null}::uuid
      order by p.created_at desc
      limit 100
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
