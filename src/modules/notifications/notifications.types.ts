import type { CursorPage, NormalizedCursorPagination } from '../../common/api/pagination.js';

export type NotificationRecord = {
  id: string;
  recipientUserId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationPreferences = {
  userId: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  orderUpdates: boolean;
  paymentUpdates: boolean;
  deliveryUpdates: boolean;
  escalationUpdates: boolean;
  settlementUpdates: boolean;
  updatedAt: string;
};

export type NotificationPreferenceUpdate = Partial<
  Pick<
    NotificationPreferences,
    | 'deliveryUpdates'
    | 'emailEnabled'
    | 'escalationUpdates'
    | 'inAppEnabled'
    | 'orderUpdates'
    | 'paymentUpdates'
    | 'pushEnabled'
    | 'settlementUpdates'
  >
>;

export type NotificationListInput = NormalizedCursorPagination;

export type MarkAllReadResult = {
  updatedCount: number;
};

export type NotificationsRepositoryContract = {
  listUserNotifications: (
    userId: string,
    input: NotificationListInput
  ) => Promise<CursorPage<NotificationRecord>>;
  markRead: (userId: string, notificationId: string) => Promise<NotificationRecord | undefined>;
  markAllRead: (userId: string) => Promise<MarkAllReadResult>;
  getPreferences: (userId: string) => Promise<NotificationPreferences>;
  upsertPreferences: (
    userId: string,
    input: NotificationPreferenceUpdate
  ) => Promise<NotificationPreferences>;
};
