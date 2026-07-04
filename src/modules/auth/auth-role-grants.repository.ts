import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import { isAdminMembershipRole, type AdminMembershipRole } from '../../domain/admin-permissions.js';

export type AdminAuthGrant = {
  role: AdminMembershipRole;
  campusId: string | null;
};

export type VendorAuthGrant = {
  vendorId: string;
};

@Injectable()
export class AuthRoleGrantsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findAdminGrantForUser(userId: string): Promise<AdminAuthGrant | undefined> {
    const result = await sql<{ role: string; campusId: string | null }>`
      select role::text as "role", campus_id::text as "campusId"
      from public.admin_memberships
      where user_id = ${userId}::uuid
        and active
      order by
        case
          when role = 'super_admin' then 0
          when role = 'campus_admin' then 1
          else 2
        end,
        granted_at desc
      limit 1
    `.execute(this.database.db);

    const grant = result.rows[0];
    if (grant === undefined || !isAdminMembershipRole(grant.role)) {
      return undefined;
    }

    return {
      campusId: grant.campusId,
      role: grant.role
    };
  }

  async findVendorGrantForUser(userId: string): Promise<VendorAuthGrant | undefined> {
    const result = await sql<VendorAuthGrant>`
      select vendor_id::text as "vendorId"
      from public.vendor_users
      where user_id = ${userId}::uuid
        and active
      order by
        case when role = 'owner' then 0 else 1 end,
        updated_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }
}
