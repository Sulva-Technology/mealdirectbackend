import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import type {
  NotificationPreferences,
  NotificationRecord,
  NotificationsRepositoryContract
} from '../../src/modules/notifications/notifications.types.js';

const actor: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const notification: NotificationRecord = {
  aggregateId: '22222222-2222-4222-8222-222222222222',
  aggregateType: 'order',
  body: 'Your order was paid successfully.',
  createdAt: '2026-06-15T09:00:00.000Z',
  eventType: 'payment.successful',
  id: '33333333-3333-4333-8333-333333333333',
  linkPath: '/orders/22222222-2222-4222-8222-222222222222',
  readAt: null,
  recipientUserId: actor.userId,
  title: 'Payment received',
  updatedAt: '2026-06-15T09:00:00.000Z'
};

const preferences: NotificationPreferences = {
  deliveryUpdates: true,
  emailEnabled: false,
  escalationUpdates: true,
  inAppEnabled: true,
  orderUpdates: true,
  paymentUpdates: true,
  pushEnabled: false,
  settlementUpdates: true,
  updatedAt: '2026-06-15T09:00:00.000Z',
  userId: actor.userId
};

function createRepository(): NotificationsRepositoryContract {
  return {
    getPreferences: vi.fn().mockResolvedValue(preferences),
    listUserNotifications: vi.fn().mockResolvedValue({
      items: [notification],
      pagination: {
        hasMore: false,
        limit: 20
      }
    }),
    markAllRead: vi.fn().mockResolvedValue({ updatedCount: 3 }),
    markRead: vi.fn().mockResolvedValue({ ...notification, readAt: '2026-06-15T10:00:00.000Z' }),
    upsertPreferences: vi.fn().mockResolvedValue(preferences)
  };
}

describe('NotificationsService', () => {
  let repository: NotificationsRepositoryContract;
  let service: NotificationsService;

  beforeEach(() => {
    repository = createRepository();
    service = new NotificationsService(repository);
  });

  it('lists notifications scoped to the current user', async () => {
    await expect(service.listNotifications(actor, { limit: 20 })).resolves.toEqual({
      items: [notification],
      pagination: {
        hasMore: false,
        limit: 20
      }
    });

    expect(repository.listUserNotifications).toHaveBeenCalledWith(actor.userId, { limit: 20 });
  });

  it('marks one notification read only inside the current user scope', async () => {
    await expect(service.markRead(actor, notification.id)).resolves.toMatchObject({
      id: notification.id,
      readAt: '2026-06-15T10:00:00.000Z'
    });

    vi.mocked(repository.markRead).mockResolvedValue(undefined);
    await expect(service.markRead(actor, notification.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('marks all current-user notifications read', async () => {
    await expect(service.markAllRead(actor)).resolves.toEqual({ updatedCount: 3 });
    expect(repository.markAllRead).toHaveBeenCalledWith(actor.userId);
  });

  it('reads and updates current-user notification preferences', async () => {
    await expect(service.getPreferences(actor)).resolves.toEqual(preferences);
    await expect(
      service.updatePreferences(actor, {
        pushEnabled: true,
        settlementUpdates: false
      })
    ).resolves.toEqual(preferences);
    expect(repository.upsertPreferences).toHaveBeenCalledWith(actor.userId, {
      pushEnabled: true,
      settlementUpdates: false
    });
  });
});
