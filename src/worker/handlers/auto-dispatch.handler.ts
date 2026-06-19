import type { OutboxEvent } from '../outbox.repository.js';

export type DispatchReads = {
  findBatchIdForOrder: (orderId: string) => Promise<string | undefined>;
  assignAvailableRider: (batchId: string) => Promise<string | null>;
};

/**
 * Auto-dispatch handler for `order.ready` outbox events: resolves the order's delivery batch
 * and asks the database to assign an available rider. No-ops when the order has no batch
 * (e.g. vendor-delivery orders). Assignment itself is idempotent per batch in the DB function.
 */
export class AutoDispatchHandler {
  constructor(private readonly reads: DispatchReads) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    const batchId = await this.reads.findBatchIdForOrder(event.aggregateId);
    if (batchId === undefined) {
      return;
    }
    await this.reads.assignAvailableRider(batchId);
  };
}
