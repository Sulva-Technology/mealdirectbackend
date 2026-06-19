import { describe, expect, it, vi } from 'vitest';

import { AutoDispatchHandler, type DispatchReads } from '../../src/worker/handlers/auto-dispatch.handler.js';
import type { OutboxEvent } from '../../src/worker/outbox.repository.js';

function makeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'evt-1',
    eventType: 'order.ready',
    aggregateType: 'order',
    aggregateId: 'order-1',
    payload: {},
    attempts: 0,
    ...overrides
  };
}

function makeReads(batchId: string | undefined): DispatchReads & {
  findBatchIdForOrder: ReturnType<typeof vi.fn>;
  assignAvailableRider: ReturnType<typeof vi.fn>;
} {
  return {
    findBatchIdForOrder: vi.fn().mockResolvedValue(batchId),
    assignAvailableRider: vi.fn().mockResolvedValue('assignment-1')
  };
}

describe('AutoDispatchHandler', () => {
  it('assigns a rider for the order batch exactly once', async () => {
    const reads = makeReads('batch-1');
    const handler = new AutoDispatchHandler(reads);

    await handler.handle(makeEvent());

    expect(reads.findBatchIdForOrder).toHaveBeenCalledWith('order-1');
    expect(reads.assignAvailableRider).toHaveBeenCalledTimes(1);
    expect(reads.assignAvailableRider).toHaveBeenCalledWith('batch-1');
  });

  it('no-ops when the order has no batch', async () => {
    const reads = makeReads(undefined);
    const handler = new AutoDispatchHandler(reads);

    await handler.handle(makeEvent());

    expect(reads.assignAvailableRider).not.toHaveBeenCalled();
  });
});
