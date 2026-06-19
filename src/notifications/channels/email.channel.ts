import type { ChannelMessage, EmailTransport, NotificationChannel } from './notification-channel.js';

export class EmailChannel implements NotificationChannel {
  constructor(private readonly transport: EmailTransport, private readonly from: string) {}

  async deliver(message: ChannelMessage): Promise<void> {
    await this.transport.send({
      from: this.from,
      to: message.to,
      subject: message.title,
      text: message.body
    });
  }
}
