import { describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../../src/notifications/channels/push.channel.js';

describe('PushChannel', () => {
  it('sends a push to every active token for the recipient', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const tokensForUser = vi.fn().mockResolvedValue(['t1', 't2']);
    const channel = new PushChannel({ send }, { tokensForUser });

    await channel.deliverToUser('user-1', {
      to: 'user-1',
      title: 'Out for delivery',
      body: 'Your rider is on the way.',
      linkPath: '/orders/1'
    });

    expect(tokensForUser).toHaveBeenCalledWith('user-1');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
