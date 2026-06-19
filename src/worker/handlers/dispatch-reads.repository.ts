import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { DispatchReads } from './auto-dispatch.handler.js';

@Injectable()
export class DispatchReadsRepository implements DispatchReads {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findBatchIdForOrder(orderId: string): Promise<string | undefined> {
    const result = await sql<{ batchId: string }>`
      select batch_id::text as "batchId"
      from public.delivery_batch_orders
      where order_id = ${orderId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0]?.batchId;
  }

  async assignAvailableRider(batchId: string): Promise<string | null> {
    const result = await sql<{ assignmentId: string | null }>`
      select public.assign_available_rider_to_batch(${batchId}::uuid) as "assignmentId"
    `.execute(this.database.db);

    return result.rows[0]?.assignmentId ?? null;
  }
}
