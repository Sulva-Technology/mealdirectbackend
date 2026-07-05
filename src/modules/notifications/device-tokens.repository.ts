import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class DeviceTokensRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async register(userId: string, token: string, platform: string): Promise<void> {
    // Re-registering a token clears any prior disabled state: a client that comes
    // back with the same token is live again, so reactivate rather than leaving it dead.
    await sql`
      insert into public.device_tokens (user_id, token, platform)
      values (${userId}::uuid, ${token}, ${platform})
      on conflict (token) do update set
        user_id = excluded.user_id,
        platform = excluded.platform,
        disabled_at = null,
        disabled_reason = null
    `.execute(this.database.db);
  }

  async remove(userId: string, token: string): Promise<void> {
    await sql`delete from public.device_tokens where user_id = ${userId}::uuid and token = ${token}`.execute(
      this.database.db
    );
  }

  // Soft-disable: mark the token dead instead of deleting it, so a bad deploy /
  // credential mismatch is recoverable and we retain an audit trail of why.
  async removeToken(token: string, reason?: string): Promise<void> {
    await sql`
      update public.device_tokens
      set disabled_at = now(), disabled_reason = ${reason ?? null}
      where token = ${token} and disabled_at is null
    `.execute(this.database.db);
  }

  async tokensForUser(userId: string): Promise<string[]> {
    const result = await sql<{ token: string }>`
      select token from public.device_tokens
      where user_id = ${userId}::uuid and disabled_at is null
    `.execute(this.database.db);
    return result.rows.map((row) => row.token);
  }
}
