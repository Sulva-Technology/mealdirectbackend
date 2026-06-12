import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationNamePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const failures = [];

for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
  const fullPath = join(migrationsDir, file);
  const sql = readFileSync(fullPath, 'utf8');

  if (!migrationNamePattern.test(file)) {
    failures.push(`${file}: migration name must be YYYYMMDDHHMMSS_snake_case.sql`);
  }

  if (/\bTODO\b|\bFIXME\b|placeholder/i.test(sql)) {
    failures.push(`${file}: remove TODO/FIXME/placeholder text before committing`);
  }

  if (/\b(double precision|real|float4|float8)\b/i.test(sql)) {
    failures.push(`${file}: floating-point data types are prohibited for business schema`);
  }

  if (
    /\bon delete cascade\b/i.test(sql) &&
    /\b(order|payment|settlement|audit|inventory|refund)/i.test(sql)
  ) {
    failures.push(
      `${file}: destructive cascade near operational or financial history is not allowed`
    );
  }

  if (!/comment on (table|column|function|view)/i.test(sql)) {
    failures.push(
      `${file}: add comments for tables, columns, functions, views, or non-obvious constraints`
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Migration lint passed.');
