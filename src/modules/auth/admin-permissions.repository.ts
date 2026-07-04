import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { isAdminMembershipRole, type AdminMembershipRole } from '../../domain/admin-permissions.js';

@Injectable()
export class AdminPermissionsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listActiveRoles(userId: string): Promise<AdminMembershipRole[]> {
    const result = await sql<{ role: string }>`
      select role::text as "role"
      from public.admin_memberships
      where user_id = ${userId}::uuid
        and active
    `.execute(this.database.db);

    return result.rows
      .map((row) => row.role)
      .filter((role): role is AdminMembershipRole => isAdminMembershipRole(role));
  }
}
