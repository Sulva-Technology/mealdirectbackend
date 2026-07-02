import type { EmailChannel } from '../../notifications/channels/email.channel.js';
import type { PushChannel } from '../../notifications/channels/push.channel.js';
import type { OutboxEvent } from '../outbox.repository.js';

export type NotificationRecipient = {
  userId: string;
  email: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  title: string;
  body: string;
  linkPath: string | null;
  notificationId: string;
};

export type NotificationReads = {
  findRecipientsForEvent(outboxEventId: string): Promise<NotificationRecipient[]>;
  alreadyDelivered(notificationId: string, channel: 'email' | 'push'): Promise<boolean>;
  recordDelivery(
    notificationId: string,
    channel: 'email' | 'push',
    status: 'sent' | 'failed',
    detail: string | null
  ): Promise<void>;
};

export class NotificationDispatchHandler {
  constructor(
    private readonly reads: NotificationReads,
    private readonly email: Pick<EmailChannel, 'deliver'>,
    private readonly push: Pick<PushChannel, 'deliverToUser'>
  ) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    // One outbox event can materialize notifications for several recipients
    // (customer + vendor users + campus admins); deliver to each.
    const recipients = await this.reads.findRecipientsForEvent(event.id);

    for (const recipient of recipients) {
      const message = {
        to: recipient.email ?? '',
        title: recipient.title,
        body: recipient.body,
        linkPath: recipient.linkPath
      };

      if (
        recipient.emailEnabled &&
        recipient.email !== null &&
        !(await this.reads.alreadyDelivered(recipient.notificationId, 'email'))
      ) {
        await this.email.deliver(message);
        await this.reads.recordDelivery(recipient.notificationId, 'email', 'sent', null);
      }

      if (
        recipient.pushEnabled &&
        !(await this.reads.alreadyDelivered(recipient.notificationId, 'push'))
      ) {
        await this.push.deliverToUser(recipient.userId, message);
        await this.reads.recordDelivery(recipient.notificationId, 'push', 'sent', null);
      }
    }
  };
}
