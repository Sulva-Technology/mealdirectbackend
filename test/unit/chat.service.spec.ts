import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CursorPage } from '../../src/common/api/pagination.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { ChatService } from '../../src/modules/chat/chat.service.js';
import type {
  ChatMessage,
  ChatParticipant,
  ChatRepositoryContract
} from '../../src/modules/chat/chat.types.js';

const batchId = '44444444-4444-4444-8444-444444444444';
const riderUserId = '11111111-1111-4111-8111-111111111111';
const customerUserId = '22222222-2222-4222-8222-222222222222';

const rider: AuthenticatedActor = { role: 'rider', userId: riderUserId };
const customer: AuthenticatedActor = { role: 'customer', userId: customerUserId };

function makeRepository(overrides: Partial<ChatRepositoryContract> = {}): ChatRepositoryContract {
  return {
    isParticipant: vi.fn().mockResolvedValue(true),
    findBatchStatus: vi.fn().mockResolvedValue('in_progress'),
    insertMessage: vi.fn(),
    listMessages: vi.fn(),
    listParticipants: vi.fn(),
    ...overrides
  };
}

function makeService(repository: ChatRepositoryContract): ChatService {
  return new ChatService(repository);
}

describe('ChatService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('postMessage', () => {
    it('rejects a non-participant with Forbidden', async () => {
      const repository = makeRepository({ isParticipant: vi.fn().mockResolvedValue(false) });
      const service = makeService(repository);

      await expect(service.postMessage(customer, batchId, 'hi')).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repository.insertMessage).not.toHaveBeenCalled();
    });

    it('rejects posting to a completed batch with Conflict', async () => {
      const repository = makeRepository({
        findBatchStatus: vi.fn().mockResolvedValue('completed')
      });
      const service = makeService(repository);

      await expect(service.postMessage(rider, batchId, 'done')).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repository.insertMessage).not.toHaveBeenCalled();
    });

    it('rejects posting to a cancelled batch with Conflict', async () => {
      const repository = makeRepository({
        findBatchStatus: vi.fn().mockResolvedValue('cancelled')
      });
      const service = makeService(repository);

      await expect(service.postMessage(rider, batchId, 'x')).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('inserts the message for an open batch participant', async () => {
      const created: ChatMessage = {
        id: '99999999-9999-4999-8999-999999999999',
        batchId,
        senderUserId: riderUserId,
        senderLabel: 'Ada Rider',
        senderRole: 'rider',
        body: 'On my way',
        createdAt: '2026-07-10T12:00:00.000Z',
        mine: true
      };
      const insertMessage = vi.fn().mockResolvedValue(created);
      const repository = makeRepository({ insertMessage });
      const service = makeService(repository);

      const result = await service.postMessage(rider, batchId, 'On my way');

      expect(result).toEqual(created);
      expect(insertMessage).toHaveBeenCalledWith(batchId, riderUserId, 'On my way');
    });
  });

  describe('listMessages', () => {
    it('rejects a non-participant with Forbidden', async () => {
      const repository = makeRepository({ isParticipant: vi.fn().mockResolvedValue(false) });
      const service = makeService(repository);

      await expect(service.listMessages(customer, batchId, {})).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it('normalises pagination and delegates to the repository', async () => {
      const page: CursorPage<ChatMessage> = {
        items: [],
        pagination: { hasMore: false, limit: 20 }
      };
      const listMessages = vi.fn().mockResolvedValue(page);
      const repository = makeRepository({ listMessages });
      const service = makeService(repository);

      const result = await service.listMessages(customer, batchId, {});

      expect(result).toBe(page);
      expect(listMessages).toHaveBeenCalledWith(batchId, customerUserId, { limit: 20 });
    });

    it('rejects an invalid cursor', async () => {
      const service = makeService(makeRepository());

      await expect(
        service.listMessages(customer, batchId, { cursor: 'not-base64-json' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listParticipants', () => {
    it('returns visible participants for a participant', async () => {
      const participants: ChatParticipant[] = [
        {
          userId: riderUserId,
          role: 'rider',
          label: 'Ada Rider',
          joinedAt: '2026-07-10T11:00:00.000Z'
        },
        {
          userId: customerUserId,
          role: 'customer',
          label: 'Customer 1',
          joinedAt: '2026-07-10T11:05:00.000Z'
        }
      ];
      const listParticipants = vi.fn().mockResolvedValue(participants);
      const repository = makeRepository({ listParticipants });
      const service = makeService(repository);

      const result = await service.listParticipants(rider, batchId);

      expect(result).toEqual(participants);
      expect(listParticipants).toHaveBeenCalledWith(batchId);
    });
  });
});
