import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import {
  decodeCursor,
  normalizeCursorPagination,
  type CursorPage,
  type CursorPaginationInput
} from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { ChatRepository } from './chat.repository.js';
import type { ChatMessage, ChatParticipant, ChatRepositoryContract } from './chat.types.js';

const CLOSED_STATUSES = new Set(['completed', 'cancelled']);

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

function badCursor(): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.VALIDATION_FAILED,
    message: 'Chat cursor is invalid.'
  });
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(ChatRepository)
    private readonly repository: ChatRepositoryContract
  ) {}

  async postMessage(
    actor: AuthenticatedActor,
    batchId: string,
    body: string
  ): Promise<ChatMessage> {
    await this.assertParticipant(actor, batchId);

    const status = await this.repository.findBatchStatus(batchId);
    if (status !== undefined && CLOSED_STATUSES.has(status)) {
      throw conflict('This batch chat is closed.');
    }

    return this.repository.insertMessage(batchId, actor.userId, body);
  }

  async listMessages(
    actor: AuthenticatedActor,
    batchId: string,
    input: CursorPaginationInput
  ): Promise<CursorPage<ChatMessage>> {
    await this.assertParticipant(actor, batchId);

    const normalized = normalizeCursorPagination(input);
    if (normalized.cursor !== undefined) {
      try {
        decodeCursor(normalized.cursor);
      } catch {
        throw badCursor();
      }
    }

    return this.repository.listMessages(batchId, actor.userId, normalized);
  }

  async listParticipants(actor: AuthenticatedActor, batchId: string): Promise<ChatParticipant[]> {
    await this.assertParticipant(actor, batchId);
    return this.repository.listParticipants(batchId);
  }

  // Read-only oversight for admins. The caller (AdminService) is responsible for
  // authorizing access (admin role + campus scope); no participant check applies, and
  // `mine` is always false since the admin is not a sender.
  listMessagesForOversight(
    batchId: string,
    input: CursorPaginationInput
  ): Promise<CursorPage<ChatMessage>> {
    const normalized = normalizeCursorPagination(input);
    if (normalized.cursor !== undefined) {
      try {
        decodeCursor(normalized.cursor);
      } catch {
        throw badCursor();
      }
    }
    return this.repository.listMessages(batchId, '', normalized);
  }

  listParticipantsForOversight(batchId: string): Promise<ChatParticipant[]> {
    return this.repository.listParticipants(batchId);
  }

  // Admin posts as "Support". Caller (AdminService) authorizes via campus-scoped
  // getBatch. The admin is added as a hidden participant so the stamp trigger accepts
  // the message; it fans out to every rider + customer on the batch.
  async postAsAdmin(batchId: string, adminUserId: string, body: string): Promise<ChatMessage> {
    const status = await this.repository.findBatchStatus(batchId);
    if (status !== undefined && CLOSED_STATUSES.has(status)) {
      throw conflict('This batch chat is closed.');
    }
    await this.repository.ensureAdminParticipant(batchId, adminUserId);
    return this.repository.insertMessage(batchId, adminUserId, body);
  }

  private async assertParticipant(actor: AuthenticatedActor, batchId: string): Promise<void> {
    const isParticipant = await this.repository.isParticipant(batchId, actor.userId);
    if (!isParticipant) {
      throw forbidden('You are not a participant of this batch chat.');
    }
  }
}
