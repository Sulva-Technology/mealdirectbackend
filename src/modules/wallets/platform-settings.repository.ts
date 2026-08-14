import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type { PlatformSettingRecord, WalletLimits } from './wallets.types.js';

// Defaults mirror the seeds in 20260727000100_platform_settings.sql so a wiped settings
// table degrades to the documented behaviour rather than to zero.
const defaultMinTopupKobo = 50_000;
const defaultMaxBalanceKobo = 5_000_000;

@Injectable()
export class PlatformSettingsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listSettings(): Promise<PlatformSettingRecord[]> {
    const result = await sql<PlatformSettingRecord>`
      select
        key,
        value,
        description,
        updated_by::text as "updatedBy",
        updated_at::text as "updatedAt"
      from public.platform_settings
      order by key
    `.execute(this.database.db);

    return result.rows;
  }

  async findWalletLimits(): Promise<WalletLimits> {
    const result = await sql<WalletLimits>`
      select
        public.platform_setting_int('wallet_min_topup_kobo', ${defaultMinTopupKobo}) as "minTopupKobo",
        public.platform_setting_int('wallet_max_balance_kobo', ${defaultMaxBalanceKobo}) as "maxBalanceKobo"
    `.execute(this.database.db);

    return (
      result.rows[0] ?? {
        minTopupKobo: defaultMinTopupKobo,
        maxBalanceKobo: defaultMaxBalanceKobo
      }
    );
  }

  async upsertSetting(
    key: string,
    value: unknown,
    actorUserId: string
  ): Promise<PlatformSettingRecord> {
    const result = await sql<PlatformSettingRecord>`
      insert into public.platform_settings (key, value, updated_by)
      values (${key}, ${JSON.stringify(value)}::jsonb, ${actorUserId}::uuid)
      on conflict (key) do update
      set value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()
      returning
        key,
        value,
        description,
        updated_by::text as "updatedBy",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Failed to upsert platform setting ${key}.`);
    }
    return row;
  }
}
