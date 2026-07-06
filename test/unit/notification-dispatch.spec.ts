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
      findRecipientsForEvent: vi.fn().mockResolvedValue([recipient]),
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
    expect(push.deliverToUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Delivered' })
    );
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'email', 'sent', null);
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'push', 'sent', null);
  });

  it('skips channels the user disabled', async () => {
    const reads = {
      findRecipientsForEvent: vi.fn().mockResolvedValue([{ ...recipient, pushEnabled: false }]),
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
      findRecipientsForEvent: vi.fn().mockResolvedValue([]),
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

  it('still delivers push when email fails, and rethrows so the event retries', async () => {
    const reads = {
      findRecipientsForEvent: vi.fn().mockResolvedValue([recipient]),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockRejectedValue(new Error('domain not verified')) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await expect(
      handler.handle({
        id: 'e1',
        eventType: 'order.delivered',
        aggregateType: 'order',
        aggregateId: 'o1',
        payload: {},
        attempts: 1
      })
    ).rejects.toThrow('domain not verified');

    // Email failed → not recorded (so it retries); push still ran + recorded 'sent'.
    expect(push.deliverToUser).toHaveBeenCalledWith('u1', expect.anything());
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'push', 'sent', null);
    expect(reads.recordDelivery).not.toHaveBeenCalledWith('n1', 'email', 'sent', null);
  });

  it('delivers to every recipient of a multi-recipient event (customer + vendor)', async () => {
    const vendorRecipient = {
      ...recipient,
      userId: 'v1',
      email: 'vendor@example.com',
      title: 'New paid order',
      notificationId: 'n2'
    };
    const reads = {
      findRecipientsForEvent: vi.fn().mockResolvedValue([recipient, vendorRecipient]),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockResolvedValue(undefined) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await handler.handle({
      id: 'e1',
      eventType: 'payment.successful',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });

    expect(push.deliverToUser).toHaveBeenCalledWith('u1', expect.anything());
    expect(push.deliverToUser).toHaveBeenCalledWith('v1', expect.anything());
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'push', 'sent', null);
    expect(reads.recordDelivery).toHaveBeenCalledWith('n2', 'push', 'sent', null);
    expect(email.deliver).toHaveBeenCalledTimes(2);
  });
});
