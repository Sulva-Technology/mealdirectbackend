import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';

export type SupportNoteSubjectType = 'payment' | 'refund' | 'order' | 'user';

export type SupportNoteRecord = {
  id: string;
  subjectType: SupportNoteSubjectType;
  subjectId: string;
  authorId: string | null;
  body: string;
  createdAt: string;
};

/**
 * Append-only internal admin notes attached to payments, refunds, orders, or users
 * (public.admin_support_notes). Notes are internal — never exposed to customers.
 */
@Injectable()
export class SupportNotesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async add(
    subjectType: SupportNoteSubjectType,
    subjectId: string,
    authorId: string,
    body: string
  ): Promise<SupportNoteRecord> {
    const result = await sql<SupportNoteRecord>`
      insert into public.admin_support_notes (subject_type, subject_id, author_id, body)
      values (${subjectType}, ${subjectId}::uuid, ${authorId}::uuid, ${body})
      returning
        id::text as "id",
        subject_type as "subjectType",
        subject_id::text as "subjectId",
        author_id::text as "authorId",
        body,
        created_at::text as "createdAt"
    `.execute(this.database.db);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Failed to insert admin support note.');
    }
    return row;
  }

  async list(subjectType: SupportNoteSubjectType, subjectId: string): Promise<SupportNoteRecord[]> {
    const result = await sql<SupportNoteRecord>`
      select
        id::text as "id",
        subject_type as "subjectType",
        subject_id::text as "subjectId",
        author_id::text as "authorId",
        body,
        created_at::text as "createdAt"
      from public.admin_support_notes
      where subject_type = ${subjectType}
        and subject_id = ${subjectId}::uuid
      order by created_at desc
    `.execute(this.database.db);
    return result.rows;
  }
}
