import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../database/database.service.js';

export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type OutboxRepositoryContract = {
  claimBatch(workerId: string, limit: number): Promise<OutboxEvent[]>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, maxAttempts: number): Promise<void>;
};

@Injectable()
export class OutboxRepository implements OutboxRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async claimBatch(workerId: string, limit: number): Promise<OutboxEvent[]> {
    const result = await sql<OutboxEvent>`
      select id::text as "id", event_type as "eventType", aggregate_type as "aggregateType",
             aggregate_id::text as "aggregateId", payload, attempts
      from public.claim_outbox_batch(${workerId}, ${limit})
    `.execute(this.database.db);
    return result.rows;
  }

  async complete(id: string): Promise<void> {
    await sql`select public.complete_outbox_event(${id}::uuid)`.execute(this.database.db);
  }

  async fail(id: string, error: string, maxAttempts: number): Promise<void> {
    await sql`select public.fail_outbox_event(${id}::uuid, ${error}, ${maxAttempts})`.execute(
      this.database.db
    );
  }
}
