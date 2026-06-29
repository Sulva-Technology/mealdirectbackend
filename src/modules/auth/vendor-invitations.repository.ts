import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';

export type VendorInvitationRecord = {
  id: string;
  vendorId: string;
  email: string;
  createdByAdminId: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateVendorInvitationInput = {
  vendorId: string;
  email: string;
  tokenHash: string;
  actorUserId: string;
  expiresInHours: number;
};

@Injectable()
export class VendorInvitationsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(input: CreateVendorInvitationInput): Promise<VendorInvitationRecord | undefined> {
    const result = await sql<VendorInvitationRecord>`
      insert into public.vendor_invitations (
        vendor_id,
        email,
        token_hash,
        created_by_admin_id,
        expires_at
      )
      values (
        ${input.vendorId}::uuid,
        ${input.email}::extensions.citext,
        ${input.tokenHash},
        ${input.actorUserId}::uuid,
        now() + (${input.expiresInHours}::integer * interval '1 hour')
      )
      returning
        id::text as "id",
        vendor_id::text as "vendorId",
        email::text as "email",
        created_by_admin_id::text as "createdByAdminId",
        expires_at::text as "expiresAt",
        accepted_at::text as "acceptedAt",
        accepted_by_user_id::text as "acceptedByUserId",
        revoked_at::text as "revokedAt",
        created_at::text as "createdAt"
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findOpenByToken(input: {
    tokenHash: string;
    email: string;
  }): Promise<VendorInvitationRecord | undefined> {
    const result = await sql<VendorInvitationRecord>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        email::text as "email",
        created_by_admin_id::text as "createdByAdminId",
        expires_at::text as "expiresAt",
        accepted_at::text as "acceptedAt",
        accepted_by_user_id::text as "acceptedByUserId",
        revoked_at::text as "revokedAt",
        created_at::text as "createdAt"
      from public.vendor_invitations
      where token_hash = ${input.tokenHash}
        and lower(email::text) = lower(${input.email})
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async accept(input: {
    tokenHash: string;
    email: string;
    userId: string;
  }): Promise<VendorInvitationRecord | undefined> {
    const result = await sql<VendorInvitationRecord>`
      with invite as (
        select *
        from public.vendor_invitations
        where token_hash = ${input.tokenHash}
          and lower(email::text) = lower(${input.email})
          and accepted_at is null
          and revoked_at is null
          and expires_at > now()
        limit 1
      ),
      linked as (
        insert into public.vendor_users (vendor_id, user_id, role)
        select vendor_id, ${input.userId}::uuid, 'owner'::public.vendor_user_role
        from invite
        on conflict (vendor_id, user_id) do update
          set role = 'owner'::public.vendor_user_role,
              active = true,
              updated_at = now()
        returning vendor_id
      )
      update public.vendor_invitations vi
      set accepted_at = now(),
          accepted_by_user_id = ${input.userId}::uuid
      from linked
      where vi.token_hash = ${input.tokenHash}
        and vi.vendor_id = linked.vendor_id
      returning
        vi.id::text as "id",
        vi.vendor_id::text as "vendorId",
        vi.email::text as "email",
        vi.created_by_admin_id::text as "createdByAdminId",
        vi.expires_at::text as "expiresAt",
        vi.accepted_at::text as "acceptedAt",
        vi.accepted_by_user_id::text as "acceptedByUserId",
        vi.revoked_at::text as "revokedAt",
        vi.created_at::text as "createdAt"
    `.execute(this.database.db);

    return result.rows[0];
  }
}
