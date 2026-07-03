import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { ActorRole } from '../../domain/authorization.js';

export type AuditActorType = 'customer' | 'vendor' | 'rider' | 'admin' | 'system';

export type AuditEntry = {
  actorUserId: string;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId?: string;
  campusId?: string;
  requestId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export function actorTypeForRole(role: ActorRole): AuditActorType {
  if (role === 'super_admin' || role === 'campus_admin') return 'admin';
  return role;
}

/**
 * Writes append-only audit_logs rows for privileged actions. Audit failures must never
 * block the audited action, so record() swallows and logs its own errors.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await sql`
        insert into public.audit_logs (
          actor_user_id, actor_type, campus_id, action, entity_type, entity_id,
          request_id, before_data, after_data, metadata
        )
        values (
          ${entry.actorUserId}::uuid,
          ${entry.actorType}::public.actor_type,
          ${entry.campusId ?? null}::uuid,
          ${entry.action},
          ${entry.entityType},
          ${entry.entityId ?? null}::uuid,
          ${entry.requestId ?? null},
          ${entry.before === undefined ? null : JSON.stringify(entry.before)}::jsonb,
          ${entry.after === undefined ? null : JSON.stringify(entry.after)}::jsonb,
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )
      `.execute(this.database.db);
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for ${entry.action} on ${entry.entityType}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }
}
