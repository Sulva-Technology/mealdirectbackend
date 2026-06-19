// scripts/db-preflight.ts
import { Pool } from 'pg';

import { createPostgresPoolConfig } from '../src/database/database.service.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';

function sanitize(message: string): string {
  return message
    .replace(/:\/\/[^:\s/@]+:[^@\s/]+@/g, '://[REDACTED]@')
    .replace(/password\s+"[^"]+"/gi, 'password "[REDACTED]"');
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const env = parseEnvironment();
  const pool = new Pool(createPostgresPoolConfig(env));
  try {
    const startedAt = Date.now();
    await pool.query('select 1 as ok');
    process.stdout.write(
      JSON.stringify({ status: 'ok', latencyMs: Date.now() - startedAt }) + '\n'
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown preflight failure';
  const code = (error as { code?: string }).code;
  process.stderr.write(
    JSON.stringify({ status: 'error', code, message: sanitize(message) }) + '\n'
  );
  process.exit(1);
});
