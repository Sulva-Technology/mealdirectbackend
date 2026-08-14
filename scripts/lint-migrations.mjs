import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationNamePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const failures = [];

// Tables whose rows are financial or operational history: a cascade that DELETES these
// through a parent delete silently destroys money/audit records and is disallowed. A FK
// that merely references a structural parent (vendors, riders, campuses, an issue row) and
// cascades its own child rows is fine, so we match on the *referenced* table, per line.
const protectedTables = [
  'orders',
  'order_items',
  'order_status_history',
  'payments',
  'payment_events',
  'settlements',
  'refunds',
  'payouts',
  'payout_transfers',
  'payout_batches',
  'wallets',
  'wallet_ledger_entries',
  'inventory_adjustments',
  'menu_item_inventory',
  'audit_logs',
  'promotion_redemptions'
];
const protectedCascadePattern = new RegExp(
  `references\\s+public\\.(?:${protectedTables.join('|')})\\b[^,]*\\bon\\s+delete\\s+cascade\\b`,
  'i'
);

// Strip -- line comments and /* */ block comments so English prose in comments (e.g. the word
// "real", or a table name mentioned in a note) never trips the code-oriented checks below.
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
  const fullPath = join(migrationsDir, file);
  const sql = readFileSync(fullPath, 'utf8');
  const code = stripComments(sql);

  if (!migrationNamePattern.test(file)) {
    failures.push(`${file}: migration name must be YYYYMMDDHHMMSS_snake_case.sql`);
  }

  // TODO/FIXME/placeholder are usually in comments — check the raw text on purpose.
  if (/\bTODO\b|\bFIXME\b|placeholder/i.test(sql)) {
    failures.push(`${file}: remove TODO/FIXME/placeholder text before committing`);
  }

  if (/\b(double precision|real|float4|float8)\b/i.test(code)) {
    failures.push(`${file}: floating-point data types are prohibited for business schema`);
  }

  // Flag a cascade only when it deletes through a financial/history table, per line.
  if (code.split('\n').some((line) => protectedCascadePattern.test(line))) {
    failures.push(
      `${file}: destructive cascade near operational or financial history is not allowed`
    );
  }

  if (!/comment on (table|column|function|view|type)/i.test(code)) {
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
