import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, type PoolConfig } from 'pg';

import { EnvService } from '../config/env.service.js';
import type { DatabaseSchema } from './database.types.js';

type DatabaseSslConfigInput = {
  DATABASE_SSL: boolean;
  DATABASE_SSL_REJECT_UNAUTHORIZED: boolean;
  DATABASE_SSL_CA?: string | undefined;
};

type DatabasePoolConfigInput = DatabaseSslConfigInput & {
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
};

const connectionStringSslParams = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslca'];

export function createPostgresSslConfig(
  config: DatabaseSslConfigInput
): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!config.DATABASE_SSL) {
    return false;
  }

  // Supabase's pooler certs are issued under Supabase's own CA, which is not in
  // Node's trust store. Providing the CA (PEM, "\n" escapes allowed) lets us keep
  // rejectUnauthorized: true instead of disabling verification.
  const ca = config.DATABASE_SSL_CA?.replace(/\\n/g, '\n');

  return {
    rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
    ...(ca === undefined || ca.length === 0 ? {} : { ca })
  };
}

function connectionStringSslMode(connectionString: string): string | undefined {
  return new URL(connectionString).searchParams.get('sslmode') ?? undefined;
}

function withoutConnectionStringSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  for (const param of connectionStringSslParams) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

function applyExplicitSslConfig(
  poolConfig: PoolConfig,
  config: DatabasePoolConfigInput,
  ssl: false | { rejectUnauthorized: boolean; ca?: string }
): void {
  poolConfig.connectionString = withoutConnectionStringSslParams(config.DATABASE_URL);
  poolConfig.ssl = ssl;
}

export function createPostgresPoolConfig(config: DatabasePoolConfigInput): PoolConfig {
  const sslMode = connectionStringSslMode(config.DATABASE_URL);
  const poolConfig: PoolConfig = {
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX
  };

  if (sslMode === 'disable') {
    applyExplicitSslConfig(poolConfig, config, false);
  } else if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'no-verify') {
    applyExplicitSslConfig(poolConfig, config, { rejectUnauthorized: false });
  } else if (config.DATABASE_SSL && !config.DATABASE_SSL_REJECT_UNAUTHORIZED) {
    applyExplicitSslConfig(poolConfig, config, createPostgresSslConfig(config));
  } else if (sslMode === undefined) {
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
