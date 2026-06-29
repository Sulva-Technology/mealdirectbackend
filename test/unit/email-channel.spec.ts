import { describe, expect, it, vi } from 'vitest';

import { EmailChannel } from '../../src/notifications/channels/email.channel.js';

describe('EmailChannel', () => {
  it('sends via the injected transport with from/to/subject/body', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = new EmailChannel({ send }, 'Meal Direct <no-reply@mealdirectly.com>');

    await channel.deliver({
      to: 'user@example.com',
      title: 'Delivered',
      body: 'Your order was delivered.',
      linkPath: '/orders/1'
    });

    expect(send).toHaveBeenCalledWith({
      from: 'Meal Direct <no-reply@mealdirectly.com>',
      to: 'user@example.com',
      subject: 'Delivered',
      text: 'Your order was delivered.'
    });
  });
});
