import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, type PoolConfig } from 'pg';

import { EnvService } from '../config/env.service.js';
import type { DatabaseSchema } from './database.types.js';

type DatabaseSslConfigInput = {
  DATABASE_SSL: boolean;
  DATABASE_SSL_REJECT_UNAUTHORIZED: boolean;
};

type DatabasePoolConfigInput = DatabaseSslConfigInput & {
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
};

export function createPostgresSslConfig(
  config: DatabaseSslConfigInput
): false | { rejectUnauthorized: boolean } {
  if (!config.DATABASE_SSL) {
    return false;
  }

  return {
    rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED
  };
}

function connectionStringHasSslMode(connectionString: string): boolean {
  return new URL(connectionString).searchParams.has('sslmode');
}

export function createPostgresPoolConfig(config: DatabasePoolConfigInput): PoolConfig {
  const poolConfig: PoolConfig = {
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX
  };

  if (!connectionStringHasSslMode(config.DATABASE_URL)) {
    poolConfig.ssl = createPostgresSslConfig(config);
  }

  return poolConfig;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  readonly db: Kysely<DatabaseSchema>;

  constructor(@Inject(EnvService) env: EnvService) {
    const config = env.all;
    this.pool = new Pool(createPostgresPoolConfig(config));

    this.db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: this.pool })
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }

  async checkHealth(): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = performance.now();
    await sql<{ ok: number }>`select 1 as ok`.execute(this.db);
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt)
    };
  }

  getPoolStats(): { totalCount: number; idleCount: number; waitingCount: number } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };
  }
}
