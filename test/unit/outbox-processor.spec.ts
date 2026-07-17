import { describe, expect, it, vi } from 'vitest';

import { HandlerRegistry, NOTIFICATION_EVENT_PREFIXES } from '../../src/worker/handler-registry.js';
import { OutboxProcessor } from '../../src/worker/outbox-processor.js';
import type { OutboxEvent, OutboxRepositoryContract } from '../../src/worker/outbox.repository.js';

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'evt-1',
    eventType: 'order.accepted',
    aggregateType: 'order',
    aggregateId: 'ord-1',
    payload: {},
    attempts: 1,
    ...overrides
  };
}

describe('OutboxProcessor.drainOnce', () => {
  it('completes events whose handlers all succeed', async () => {
    const claimBatch = vi.fn().mockResolvedValue([event()]);
    const complete = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue(undefined);
    const repo: OutboxRepositoryContract = { claimBatch, complete, fail };

    const registry = new HandlerRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('order.accepted', handler);

    const processor = new OutboxProcessor(repo, registry, { batchSize: 10, maxAttempts: 5 });
    const count = await processor.drainOnce('w1');

    expect(count).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('evt-1');
    expect(fail).not.toHaveBeenCalled();
  });

  it('fails the event when a handler throws', async () => {
    const claimBatch = vi.fn().mockResolvedValue([event()]);
    const complete = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue(undefined);
    const repo: OutboxRepositoryContract = { claimBatch, complete, fail };

    const registry = new HandlerRegistry();
    registry.register('order.accepted', vi.fn().mockRejectedValue(new Error('boom')));

    const processor = new OutboxProcessor(repo, registry, { batchSize: 10, maxAttempts: 5 });
    await processor.drainOnce('w1');

    expect(fail).toHaveBeenCalledWith('evt-1', expect.stringContaining('boom'), 5);
    expect(complete).not.toHaveBeenCalled();
  });

  it('routes every notification-bearing event family to a dispatch handler', () => {
    const registry = new HandlerRegistry();
    const handler = vi.fn();
    for (const prefix of NOTIFICATION_EVENT_PREFIXES) {
      registry.registerPrefix(prefix, handler);
    }

    // One representative event per family that materializes notification rows.
    // A missing prefix here silently completes outbox events without ever
    // sending push/email (that is how rider push broke).
    for (const eventType of [
      'order.accepted',
      'payment.confirmed',
      'settlement.paid',
      'batch_chat.message_posted',
      'rider.assignment'
    ]) {
      expect(registry.handlersFor(eventType), eventType).toContain(handler);
    }
  });

  it('completes events with no registered handler (no-op)', async () => {
    const claimBatch = vi.fn().mockResolvedValue([event({ eventType: 'unmapped.event' })]);
    const complete = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue(undefined);
    const repo: OutboxRepositoryContract = { claimBatch, complete, fail };

    const processor = new OutboxProcessor(repo, new HandlerRegistry(), {
      batchSize: 10,
      maxAttempts: 5
    });
    await processor.drainOnce('w1');
    expect(complete).toHaveBeenCalledWith('evt-1');
  });
});
