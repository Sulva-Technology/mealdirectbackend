import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class DeviceTokensRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async register(userId: string, token: string, platform: string): Promise<void> {
    await sql`
      insert into public.device_tokens (user_id, token, platform)
      values (${userId}::uuid, ${token}, ${platform})
      on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform
    `.execute(this.database.db);
  }

  async remove(userId: string, token: string): Promise<void> {
    await sql`delete from public.device_tokens where user_id = ${userId}::uuid and token = ${token}`.execute(
      this.database.db
    );
  }

  async tokensForUser(userId: string): Promise<string[]> {
    const result = await sql<{ token: string }>`
      select token from public.device_tokens where user_id = ${userId}::uuid
    `.execute(this.database.db);
    return result.rows.map((row) => row.token);
  }
}
