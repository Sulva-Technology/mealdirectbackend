import type { CursorPage } from '../../common/api/pagination.js';

export type ChatSenderRole = 'rider' | 'customer' | 'vendor' | 'admin';

export type ChatMessage = {
  id: string;
  batchId: string;
  senderUserId: string;
  senderLabel: string;
  senderRole: ChatSenderRole;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ChatParticipant = {
  userId: string;
  role: ChatSenderRole;
  label: string;
  joinedAt: string;
};

export type ChatMessageListInput = {
  cursor?: string;
  limit: number;
};

export type ChatRepositoryContract = {
  isParticipant: (batchId: string, userId: string) => Promise<boolean>;
  findBatchStatus: (batchId: string) => Promise<string | undefined>;
  ensureAdminParticipant: (batchId: string, userId: string) => Promise<void>;
  insertMessage: (batchId: string, senderUserId: string, body: string) => Promise<ChatMessage>;
  listMessages: (
    batchId: string,
    viewerUserId: string,
    input: ChatMessageListInput
  ) => Promise<CursorPage<ChatMessage>>;
  listParticipants: (batchId: string) => Promise<ChatParticipant[]>;
};
