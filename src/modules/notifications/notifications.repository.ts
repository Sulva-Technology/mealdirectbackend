import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  createCursorPage,
  decodeCursor,
  encodeCursor,
  type CursorPayload,
  type CursorPage
} from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type {
  MarkAllReadResult,
  NotificationListInput,
  NotificationPreferenceUpdate,
  NotificationPreferences,
  NotificationRecord,
  NotificationsRepositoryContract
} from './notifications.types.js';

type UpdatedCountResult = {
  updatedCount: string | number;
};

function notificationCursorPayload(cursor: string | undefined): CursorPayload | undefined {
  if (cursor === undefined) return undefined;
  return decodeCursor(cursor);
}

function cursorString(payload: CursorPayload | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Injectable()
export class NotificationsRepository implements NotificationsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listUserNotifications(
    userId: string,
    input: NotificationListInput
  ): Promise<CursorPage<NotificationRecord>> {
    const cursor = notificationCursorPayload(input.cursor);
    const cursorCreatedAt = cursorString(cursor, 'createdAt');
    const cursorId = cursorString(cursor, 'id');

    const result = await sql<NotificationRecord>`
      select
        id::text as "id",
        recipient_user_id::text as "recipientUserId",
        event_type as "eventType",
        aggregate_type as "aggregateType",
        aggregate_id::text as "aggregateId",
        title,
        body,
        link_path as "linkPath",
        read_at::text as "readAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.notifications
      where recipient_user_id = ${userId}::uuid
        and (
          ${cursorCreatedAt ?? null}::timestamptz is null
          or (
            created_at,
            id
          ) < (
            ${cursorCreatedAt ?? null}::timestamptz,
            ${cursorId ?? null}::uuid
          )
        )
      order by created_at desc, id desc
      limit ${input.limit + 1}
    `.execute(this.database.db);

    return createCursorPage(result.rows, input.limit, (item) =>
      encodeCursor({ createdAt: item.createdAt, id: item.id })
    );
  }

  async markRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationRecord | undefined> {
    const result = await sql<NotificationRecord>`
      update public.notifications
      set read_at = coalesce(read_at, now())
      where id = ${notificationId}::uuid
        and recipient_user_id = ${userId}::uuid
      returning
        id::text as "id",
        recipient_user_id::text as "recipientUserId",
        event_type as "eventType",
        aggregate_type as "aggregateType",
        aggregate_id::text as "aggregateId",
        title,
        body,
        link_path as "linkPath",
        read_at::text as "readAt",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async markAllRead(userId: string): Promise<MarkAllReadResult> {
    const result = await sql<UpdatedCountResult>`
      with updated as (
        update public.notifications
        set read_at = now()
        where recipient_user_id = ${userId}::uuid
          and read_at is null
        returning 1
      )
      select count(*) as "updatedCount"
      from updated
    `.execute(this.database.db);

    const value = result.rows[0]?.updatedCount ?? 0;
    return {
      updatedCount: typeof value === 'number' ? value : Number.parseInt(value, 10)
    };
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    await sql`
      insert into public.notification_preferences (user_id)
      values (${userId}::uuid)
      on conflict (user_id) do nothing
    `.execute(this.database.db);

    const preferences = await this.findPreferences(userId);
    if (preferences === undefined) {
      throw new Error('Notification preferences could not be loaded.');
    }
    return preferences;
  }

  async upsertPreferences(
    userId: string,
    input: NotificationPreferenceUpdate
  ): Promise<NotificationPreferences> {
    await this.getPreferences(userId);

    const hasInAppEnabled = Object.hasOwn(input, 'inAppEnabled');
    const hasPushEnabled = Object.hasOwn(input, 'pushEnabled');
    const hasEmailEnabled = Object.hasOwn(input, 'emailEnabled');
    const hasOrderUpdates = Object.hasOwn(input, 'orderUpdates');
    const hasPaymentUpdates = Object.hasOwn(input, 'paymentUpdates');
    const hasDeliveryUpdates = Object.hasOwn(input, 'deliveryUpdates');
    const hasEscalationUpdates = Object.hasOwn(input, 'escalationUpdates');
    const hasSettlementUpdates = Object.hasOwn(input, 'settlementUpdates');

    const result = await sql<NotificationPreferences>`
      update public.notification_preferences
      set in_app_enabled = case when ${hasInAppEnabled} then ${input.inAppEnabled ?? null} else in_app_enabled end,
          push_enabled = case when ${hasPushEnabled} then ${input.pushEnabled ?? null} else push_enabled end,
          email_enabled = case when ${hasEmailEnabled} then ${input.emailEnabled ?? null} else email_enabled end,
          order_updates = case when ${hasOrderUpdates} then ${input.orderUpdates ?? null} else order_updates end,
          payment_updates = case when ${hasPaymentUpdates} then ${input.paymentUpdates ?? null} else payment_updates end,
          delivery_updates = case when ${hasDeliveryUpdates} then ${input.deliveryUpdates ?? null} else delivery_updates end,
          escalation_updates = case when ${hasEscalationUpdates} then ${input.escalationUpdates ?? null} else escalation_updates end,
          settlement_updates = case when ${hasSettlementUpdates} then ${input.settlementUpdates ?? null} else settlement_updates end,
          updated_at = now()
      where user_id = ${userId}::uuid
      returning
        user_id::text as "userId",
        in_app_enabled as "inAppEnabled",
        push_enabled as "pushEnabled",
        email_enabled as "emailEnabled",
        order_updates as "orderUpdates",
        payment_updates as "paymentUpdates",
        delivery_updates as "deliveryUpdates",
        escalation_updates as "escalationUpdates",
        settlement_updates as "settlementUpdates",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const preferences = result.rows[0];
    if (preferences === undefined) {
      throw new Error('Notification preferences update did not return a row.');
    }
    return preferences;
  }

  private async findPreferences(userId: string): Promise<NotificationPreferences | undefined> {
    const result = await sql<NotificationPreferences>`
      select
        user_id::text as "userId",
        in_app_enabled as "inAppEnabled",
        push_enabled as "pushEnabled",
        email_enabled as "emailEnabled",
        order_updates as "orderUpdates",
        payment_updates as "paymentUpdates",
        delivery_updates as "deliveryUpdates",
        escalation_updates as "escalationUpdates",
        settlement_updates as "settlementUpdates",
        updated_at::text as "updatedAt"
      from public.notification_preferences
      where user_id = ${userId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }
}
