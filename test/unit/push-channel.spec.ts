import { describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../../src/notifications/channels/push.channel.js';

describe('PushChannel', () => {
  it('sends a push to every active token for the recipient', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const tokensForUser = vi.fn().mockResolvedValue(['t1', 't2']);
    const removeToken = vi.fn().mockResolvedValue(undefined);
    const channel = new PushChannel({ send }, { tokensForUser, removeToken });

    await channel.deliverToUser('user-1', {
      to: 'user-1',
      title: 'Out for delivery',
      body: 'Your rider is on the way.',
      linkPath: '/orders/1'
    });

    expect(tokensForUser).toHaveBeenCalledWith('user-1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(removeToken).not.toHaveBeenCalled();
  });

  it('prunes invalid tokens without throwing so the event completes', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error('The registration token is not a valid FCM registration token'), {
          code: 'messaging/invalid-argument'
        })
      );
    const tokensForUser = vi.fn().mockResolvedValue(['good', 'bad']);
    const removeToken = vi.fn().mockResolvedValue(undefined);
    const channel = new PushChannel({ send }, { tokensForUser, removeToken });

    await expect(
      channel.deliverToUser('user-1', {
        to: 'user-1',
        title: 'Order ready',
        body: 'Ready.',
        linkPath: '/orders/1'
      })
    ).resolves.toBeUndefined();

    expect(removeToken).toHaveBeenCalledExactlyOnceWith('bad');
  });

  it('rethrows transient send errors so the outbox retries', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const tokensForUser = vi.fn().mockResolvedValue(['t1']);
    const removeToken = vi.fn().mockResolvedValue(undefined);
    const channel = new PushChannel({ send }, { tokensForUser, removeToken });

    await expect(
      channel.deliverToUser('user-1', {
        to: 'user-1',
        title: 'Order ready',
        body: 'Ready.',
        linkPath: '/orders/1'
      })
    ).rejects.toThrow('network unavailable');
    expect(removeToken).not.toHaveBeenCalled();
  });
});
