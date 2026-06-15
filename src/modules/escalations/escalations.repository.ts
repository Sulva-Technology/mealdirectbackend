import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CreateEscalationInput,
  EscalationEligibility,
  EscalationRecord,
  EscalationsRepositoryContract
} from './escalations.types.js';

type EscalationIdResult = {
  escalationId: string;
};

@Injectable()
export class EscalationsRepository implements EscalationsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findCustomerEscalationEligibility(
    customerId: string,
    orderId: string
  ): Promise<EscalationEligibility | undefined> {
    const result = await sql<EscalationEligibility>`
      select
        id::text as "orderId",
        order_status::text as "orderStatus"
      from public.orders
      where id = ${orderId}::uuid
        and customer_id = ${customerId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findOpenCustomerEscalation(
    customerId: string,
    orderId: string
  ): Promise<EscalationRecord | undefined> {
    const result = await sql<EscalationRecord>`
      select
        e.id::text as "id",
        e.order_id::text as "orderId",
        e.opened_by::text as "openedBy",
        e.category,
        e.description,
        e.status::text as "status",
        e.assigned_admin_id::text as "assignedAdminId",
        e.resolution,
        e.refund_id::text as "refundId",
        e.opened_at::text as "openedAt",
        e.resolved_at::text as "resolvedAt",
        e.created_at::text as "createdAt",
        e.updated_at::text as "updatedAt"
      from public.escalations e
      join public.orders o on o.id = e.order_id
      where e.order_id = ${orderId}::uuid
        and o.customer_id = ${customerId}::uuid
        and e.status in ('open', 'investigating')
      order by e.opened_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async listCustomerOrderEscalations(
    customerId: string,
    orderId: string
  ): Promise<EscalationRecord[]> {
    const result = await sql<EscalationRecord>`
      select
        e.id::text as "id",
        e.order_id::text as "orderId",
        e.opened_by::text as "openedBy",
        e.category,
        e.description,
        e.status::text as "status",
        e.assigned_admin_id::text as "assignedAdminId",
        e.resolution,
        e.refund_id::text as "refundId",
        e.opened_at::text as "openedAt",
        e.resolved_at::text as "resolvedAt",
        e.created_at::text as "createdAt",
        e.updated_at::text as "updatedAt"
      from public.escalations e
      join public.orders o on o.id = e.order_id
      where e.order_id = ${orderId}::uuid
        and o.customer_id = ${customerId}::uuid
      order by e.opened_at desc
    `.execute(this.database.db);

    return result.rows;
  }

  async openCustomerEscalation(
    customerId: string,
    orderId: string,
    input: CreateEscalationInput
  ): Promise<EscalationRecord> {
    const result = await sql<EscalationIdResult>`
      select public.open_escalation(
        ${orderId}::uuid,
        ${customerId}::uuid,
        ${input.category},
        ${input.description}
      )::text as "escalationId"
    `.execute(this.database.db);

    const escalationId = result.rows[0]?.escalationId;
    if (escalationId === undefined) {
      throw new Error('Escalation creation did not return an escalation ID.');
    }

    const escalation = await this.findCustomerEscalationById(customerId, escalationId);
    if (escalation === undefined) {
      throw new Error('Created escalation could not be loaded.');
    }
    return escalation;
  }

  private async findCustomerEscalationById(
    customerId: string,
    escalationId: string
  ): Promise<EscalationRecord | undefined> {
    const result = await sql<EscalationRecord>`
      select
        e.id::text as "id",
        e.order_id::text as "orderId",
        e.opened_by::text as "openedBy",
        e.category,
        e.description,
        e.status::text as "status",
        e.assigned_admin_id::text as "assignedAdminId",
        e.resolution,
        e.refund_id::text as "refundId",
        e.opened_at::text as "openedAt",
        e.resolved_at::text as "resolvedAt",
        e.created_at::text as "createdAt",
        e.updated_at::text as "updatedAt"
      from public.escalations e
      join public.orders o on o.id = e.order_id
      where e.id = ${escalationId}::uuid
        and o.customer_id = ${customerId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }
}
