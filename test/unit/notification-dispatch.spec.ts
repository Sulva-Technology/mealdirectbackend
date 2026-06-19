import { describe, expect, it, vi } from 'vitest';

import { NotificationDispatchHandler } from '../../src/worker/handlers/notification-dispatch.handler.js';

const recipient = {
  userId: 'u1',
  email: 'u1@example.com',
  emailEnabled: true,
  pushEnabled: true,
  title: 'Delivered',
  body: 'Your order was delivered.',
  linkPath: '/orders/1',
  notificationId: 'n1'
};

describe('NotificationDispatchHandler', () => {
  it('delivers email + push and records both when enabled and not already sent', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue(recipient),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockResolvedValue(undefined) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });

    expect(email.deliver).toHaveBeenCalledTimes(1);
    expect(push.deliverToUser).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Delivered' }));
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'email', 'sent', null);
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'push', 'sent', null);
  });

  it('skips channels the user disabled', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue({ ...recipient, pushEnabled: false }),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockResolvedValue(undefined) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });
    expect(push.deliverToUser).not.toHaveBeenCalled();
  });

  it('no-ops when there is no materialized notification recipient', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue(undefined),
      alreadyDelivered: vi.fn(),
      recordDelivery: vi.fn()
    };
    const email = { deliver: vi.fn() };
    const push = { deliverToUser: vi.fn() };
    const handler = new NotificationDispatchHandler(reads, email, push);
    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });
    expect(email.deliver).not.toHaveBeenCalled();
  });
});
