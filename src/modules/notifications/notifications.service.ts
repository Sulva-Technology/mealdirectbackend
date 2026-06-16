import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  decodeCursor,
  normalizeCursorPagination,
  type CursorPage,
  type CursorPaginationInput
} from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { NotificationsRepository } from './notifications.repository.js';
import type {
  MarkAllReadResult,
  NotificationPreferenceUpdate,
  NotificationPreferences,
  NotificationRecord,
  NotificationsRepositoryContract
} from './notifications.types.js';

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NotificationsRepository)
    private readonly repository: NotificationsRepositoryContract
  ) {}

  listNotifications(
    actor: AuthenticatedActor,
    input: CursorPaginationInput
  ): Promise<CursorPage<NotificationRecord>> {
    const normalized = normalizeCursorPagination(input);
    if (normalized.cursor !== undefined) {
      try {
        decodeCursor(normalized.cursor);
      } catch {
        throw badRequest('Notification cursor is invalid.');
      }
    }
    return this.repository.listUserNotifications(actor.userId, normalized);
  }

  async markRead(actor: AuthenticatedActor, notificationId: string): Promise<NotificationRecord> {
    const notification = await this.repository.markRead(actor.userId, notificationId);
    if (notification === undefined) {
      throw notFound('Notification was not found.');
    }
    return notification;
  }

  markAllRead(actor: AuthenticatedActor): Promise<MarkAllReadResult> {
    return this.repository.markAllRead(actor.userId);
  }

  getPreferences(actor: AuthenticatedActor): Promise<NotificationPreferences> {
    return this.repository.getPreferences(actor.userId);
  }

  updatePreferences(
    actor: AuthenticatedActor,
    input: NotificationPreferenceUpdate
  ): Promise<NotificationPreferences> {
    return this.repository.upsertPreferences(actor.userId, input);
  }
}
