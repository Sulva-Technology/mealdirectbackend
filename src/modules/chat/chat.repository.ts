import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  createCursorPage,
  decodeCursor,
  encodeCursor,
  type CursorPage,
  type CursorPayload
} from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type {
  ChatMessage,
  ChatMessageListInput,
  ChatParticipant,
  ChatRepositoryContract
} from './chat.types.js';

type ChatMessageRow = Omit<ChatMessage, 'mine'>;

function cursorString(payload: CursorPayload | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Injectable()
export class ChatRepository implements ChatRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async isParticipant(batchId: string, userId: string): Promise<boolean> {
    const result = await sql<{ isParticipant: boolean }>`
      select public.is_batch_chat_participant(${batchId}::uuid, ${userId}::uuid) as "isParticipant"
    `.execute(this.database.db);

    return result.rows[0]?.isParticipant ?? false;
  }

  async findBatchStatus(batchId: string): Promise<string | undefined> {
    const result = await sql<{ status: string }>`
      select status::text as "status"
      from public.delivery_batches
      where id = ${batchId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.status;
  }

  async insertMessage(batchId: string, senderUserId: string, body: string): Promise<ChatMessage> {
    // sender_label / sender_role are populated by the batch_messages_stamp
    // BEFORE trigger from the participant row, so we omit them here.
    const result = await sql<ChatMessageRow>`
      insert into public.batch_messages (batch_id, sender_user_id, body)
      values (${batchId}::uuid, ${senderUserId}::uuid, ${body})
      returning
        id::text as "id",
        batch_id::text as "batchId",
        sender_user_id::text as "senderUserId",
        sender_label as "senderLabel",
        sender_role as "senderRole",
        body,
        created_at::text as "createdAt"
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Chat message insert did not return a row.');
    }
    return { ...row, mine: true };
  }

  async listMessages(
    batchId: string,
    viewerUserId: string,
    input: ChatMessageListInput
  ): Promise<CursorPage<ChatMessage>> {
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const cursorCreatedAt = cursorString(cursor, 'createdAt');
    const cursorId = cursorString(cursor, 'id');

    const result = await sql<ChatMessageRow>`
      select
        id::text as "id",
        batch_id::text as "batchId",
        sender_user_id::text as "senderUserId",
        sender_label as "senderLabel",
        sender_role as "senderRole",
        body,
        created_at::text as "createdAt"
      from public.batch_messages
      where batch_id = ${batchId}::uuid
        and (
          ${cursorCreatedAt ?? null}::timestamptz is null
          or (created_at, id) < (${cursorCreatedAt ?? null}::timestamptz, ${cursorId ?? null}::uuid)
        )
      order by created_at desc, id desc
      limit ${input.limit + 1}
    `.execute(this.database.db);

    const rows: ChatMessage[] = result.rows.map((row) => ({
      ...row,
      mine: row.senderUserId === viewerUserId
    }));

    return createCursorPage(rows, input.limit, (item) =>
      encodeCursor({ createdAt: item.createdAt, id: item.id })
    );
  }

  async listParticipants(batchId: string): Promise<ChatParticipant[]> {
    const result = await sql<ChatParticipant>`
      select
        user_id::text as "userId",
        role,
        label,
        joined_at::text as "joinedAt"
      from public.batch_chat_participants
      where batch_id = ${batchId}::uuid
        and hidden = false
      order by role, joined_at
    `.execute(this.database.db);

    return result.rows;
  }
}
