import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type {
  ReconciliationCursor,
  ReconciliationIssueListFilter,
  ReconciliationIssueListResult,
  ReconciliationIssueRecord,
  ReconciliationIssueStatus,
  ReconciliationNoteRecord
} from './reconciliation.types.js';

const issueColumns = sql`
  id::text as "id",
  issue_type::text as "issueType",
  status::text as "status",
  severity::text as "severity",
  payment_id::text as "paymentId",
  order_id::text as "orderId",
  refund_id::text as "refundId",
  campus_id::text as "campusId",
  provider_reference as "providerReference",
  detail as "detail",
  first_detected_at::text as "firstDetectedAt",
  last_detected_at::text as "lastDetectedAt",
  reviewed_by::text as "reviewedBy",
  reviewed_at::text as "reviewedAt",
  resolution_note as "resolutionNote"
`;

function toCursor(value: string): ReconciliationCursor | undefined {
  try {
    const payload = decodeCursor(value);
    if (typeof payload.lastDetectedAt === 'string' && typeof payload.id === 'string') {
      return { lastDetectedAt: payload.lastDetectedAt, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class ReconciliationRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async scan(staleSeconds: number, refundStaleSeconds: number): Promise<number> {
    const result = await sql<{ count: number }>`
      select public.scan_payment_reconciliation(${staleSeconds}, ${refundStaleSeconds}) as "count"
    `.execute(this.database.db);
    return result.rows[0]?.count ?? 0;
  }

  async listIssues(
    filter: ReconciliationIssueListFilter,
    pagination: { cursor?: string; limit: number },
    campusId?: string
  ): Promise<ReconciliationIssueListResult> {
    const cursor = pagination.cursor === undefined ? undefined : toCursor(pagination.cursor);
    const result = await sql<ReconciliationIssueRecord>`
      select ${issueColumns}
      from public.payment_reconciliation_issues
      where (${filter.status ?? null}::public.payment_reconciliation_issue_status is null
             or status = ${filter.status ?? null}::public.payment_reconciliation_issue_status)
        and (${filter.issueType ?? null}::public.payment_reconciliation_issue_type is null
             or issue_type = ${filter.issueType ?? null}::public.payment_reconciliation_issue_type)
        and (${filter.severity ?? null}::public.payment_reconciliation_severity is null
             or severity = ${filter.severity ?? null}::public.payment_reconciliation_severity)
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
        and (
          ${cursor?.lastDetectedAt ?? null}::timestamptz is null
          or (last_detected_at, id) <
             (${cursor?.lastDetectedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by last_detected_at desc, id desc
      limit ${pagination.limit + 1}
    `.execute(this.database.db);

    const rows = result.rows;
    const hasMore = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const last = items.at(-1);

    return {
      items,
      hasMore,
      limit: pagination.limit,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor({ lastDetectedAt: last.lastDetectedAt, id: last.id }) }
        : {})
    };
  }

  async findIssueById(
    issueId: string,
    campusId?: string
  ): Promise<ReconciliationIssueRecord | undefined> {
    const result = await sql<ReconciliationIssueRecord>`
      select ${issueColumns}
      from public.payment_reconciliation_issues
      where id = ${issueId}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      limit 1
    `.execute(this.database.db);
    return result.rows[0];
  }

  async listNotes(issueId: string): Promise<ReconciliationNoteRecord[]> {
    const result = await sql<ReconciliationNoteRecord>`
      select
        id::text as "id",
        issue_id::text as "issueId",
        author_id::text as "authorId",
        body,
        created_at::text as "createdAt"
      from public.payment_reconciliation_notes
      where issue_id = ${issueId}::uuid
      order by created_at asc
    `.execute(this.database.db);
    return result.rows;
  }

  async addNote(
    issueId: string,
    authorId: string,
    body: string
  ): Promise<ReconciliationNoteRecord> {
    const result = await sql<ReconciliationNoteRecord>`
      insert into public.payment_reconciliation_notes (issue_id, author_id, body)
      values (${issueId}::uuid, ${authorId}::uuid, ${body})
      returning
        id::text as "id",
        issue_id::text as "issueId",
        author_id::text as "authorId",
        body,
        created_at::text as "createdAt"
    `.execute(this.database.db);
    const note = result.rows[0];
    if (note === undefined) {
      throw new Error('Reconciliation note insert did not return a row.');
    }
    return note;
  }

  async reviewIssue(
    issueId: string,
    status: ReconciliationIssueStatus,
    reviewedBy: string,
    resolutionNote: string | undefined,
    campusId?: string
  ): Promise<ReconciliationIssueRecord | undefined> {
    const result = await sql<ReconciliationIssueRecord>`
      update public.payment_reconciliation_issues
      set status = ${status}::public.payment_reconciliation_issue_status,
          reviewed_by = ${reviewedBy}::uuid,
          reviewed_at = now(),
          resolution_note = coalesce(${resolutionNote ?? null}, resolution_note)
      where id = ${issueId}::uuid
        and (${campusId ?? null}::uuid is null or campus_id = ${campusId ?? null}::uuid)
      returning ${issueColumns}
    `.execute(this.database.db);
    return result.rows[0];
  }
}
