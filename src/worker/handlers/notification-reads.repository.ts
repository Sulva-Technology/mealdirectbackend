import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { NotificationReads, NotificationRecipient } from './notification-dispatch.handler.js';

@Injectable()
export class NotificationReadsRepository implements NotificationReads {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findRecipientsForEvent(outboxEventId: string): Promise<NotificationRecipient[]> {
    const result = await sql<{
      userId: string;
      email: string | null;
      emailEnabled: boolean;
      pushEnabled: boolean;
      title: string;
      body: string;
      linkPath: string | null;
      notificationId: string;
    }>`
      select
        n.recipient_user_id::text as "userId",
        pr.email as "email",
        -- Chat is push + in-app only; never email chat traffic even if the user
        -- has the email channel enabled globally.
        case when n.event_type like 'batch_chat.%' then false
             else coalesce(p.email_enabled, false) end as "emailEnabled",
        coalesce(p.push_enabled, false) as "pushEnabled",
        n.title as "title",
        n.body as "body",
        n.link_path as "linkPath",
        n.id::text as "notificationId"
      from public.notifications n
      join public.profiles pr on pr.id = n.recipient_user_id
      left join public.notification_preferences p on p.user_id = n.recipient_user_id
      where n.source_outbox_event_id = ${outboxEventId}::uuid
    `.execute(this.database.db);

    return result.rows;
  }

  async alreadyDelivered(notificationId: string, channel: 'email' | 'push'): Promise<boolean> {
    const result = await sql<{ delivered: boolean }>`
      select exists(
        select 1 from public.notification_deliveries
        where notification_id = ${notificationId}::uuid and channel = ${channel}
      ) as "delivered"
    `.execute(this.database.db);

    return result.rows[0]?.delivered ?? false;
  }

  async recordDelivery(
    notificationId: string,
    channel: 'email' | 'push',
    status: 'sent' | 'failed',
    detail: string | null
  ): Promise<void> {
    await sql`
      insert into public.notification_deliveries (notification_id, channel, status, detail)
      values (${notificationId}::uuid, ${channel}, ${status}, ${detail})
      on conflict (notification_id, channel) do nothing
    `.execute(this.database.db);
  }
}
