import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { OutboxListQueryDto } from './dto/jobs.dto.js';
import type { JobsRecord, OutboxProcessResult, SystemSummary } from './jobs.types.js';

@Injectable()
export class JobsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getSystemSummary(): Promise<SystemSummary> {
    const [time, outbox] = await Promise.all([
      sql<JobsRecord>`select now()::text as "databaseTime"`.execute(this.database.db),
      sql<JobsRecord>`
        select
          count(*) filter (where processed_at is null and locked_at is null and available_at <= now())::integer as "available",
          count(*) filter (where processed_at is null and locked_at is not null)::integer as "locked",
          count(*) filter (where processed_at is null and attempts > 0 and last_error is not null)::integer as "failed",
          count(*) filter (where processed_at is not null)::integer as "processed"
        from public.outbox_events
      `.execute(this.database.db)
    ]);

    return {
      databaseTime: (time.rows[0]?.databaseTime as string | undefined) ?? null,
      outbox: outbox.rows[0] ?? {},
      worker: {
        registeredQueues: ['outbox_events']
      }
    };
  }

  async listOutboxEvents(query: OutboxListQueryDto): Promise<JobsRecord[]> {
    const limit = query.limit ?? 20;
    const result = await sql<JobsRecord>`
      select
        id::text as "id",
        event_type as "eventType",
        aggregate_type as "aggregateType",
        aggregate_id::text as "aggregateId",
        payload,
        available_at::text as "availableAt",
        attempts,
        locked_at::text as "lockedAt",
        locked_by as "lockedBy",
        processed_at::text as "processedAt",
        last_error as "lastError",
        created_at::text as "createdAt"
      from public.outbox_events
      where (${query.eventType ?? null}::text is null or event_type = ${query.eventType ?? null})
        and (
          ${query.status ?? null}::text is null
          or (${query.status ?? null} = 'available' and processed_at is null and locked_at is null and available_at <= now())
          or (${query.status ?? null} = 'locked' and processed_at is null and locked_at is not null)
          or (${query.status ?? null} = 'failed' and processed_at is null and attempts > 0 and last_error is not null)
          or (${query.status ?? null} = 'processed' and processed_at is not null)
        )
      order by created_at desc, id desc
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  async claimAvailableOutboxEvents(limit: number, workerId: string): Promise<OutboxProcessResult> {
    const events = await this.database.db.transaction().execute(async (trx) => {
      const result = await sql<JobsRecord>`
        with claimed as (
          select id
          from public.outbox_events
          where processed_at is null
            and locked_at is null
            and available_at <= now()
          order by available_at asc, created_at asc
          limit ${limit}
          for update skip locked
        )
        update public.outbox_events oe
        set locked_at = now(),
            locked_by = ${workerId},
            attempts = attempts + 1
        from claimed
        where oe.id = claimed.id
        returning
          oe.id::text as "id",
          oe.event_type as "eventType",
          oe.aggregate_type as "aggregateType",
          oe.aggregate_id::text as "aggregateId",
          oe.payload,
          oe.available_at::text as "availableAt",
          oe.attempts,
          oe.locked_at::text as "lockedAt",
          oe.locked_by as "lockedBy",
          oe.created_at::text as "createdAt"
      `.execute(trx);

      return result.rows;
    });

    return {
      claimedCount: events.length,
      events,
      workerId
    };
  }
}
