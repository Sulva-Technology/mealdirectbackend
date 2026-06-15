import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const requiredTables = [
  'profiles',
  'campuses',
  'campus_locations',
  'vendors',
  'riders',
  'menu_items',
  'delivery_slots',
  'menu_item_inventory',
  'orders',
  'order_items',
  'idempotency_keys',
  'payments',
  'payment_events',
  'refunds',
  'delivery_batches',
  'delivery_assignments',
  'delivery_confirmations',
  'escalations',
  'settlements',
  'settlement_lines',
  'outbox_events',
  'notifications',
  'notification_preferences',
  'audit_logs'
] as const;

const requiredFunctions = [
  'handle_new_auth_user',
  'available_vendors',
  'available_menu_items',
  'effective_ordering_cutoff_at',
  'create_pending_order_and_reserve_inventory',
  'release_expired_reservations',
  'record_payment_event',
  'mark_verified_payment_successful',
  'add_paid_order_to_batch',
  'transition_order_status',
  'confirm_delivery',
  'open_escalation',
  'create_notification_for_outbox_event',
  'notification_topic_enabled',
  'produce_vendor_daily_settlement',
  'produce_rider_daily_settlement',
  'can_read_order',
  'can_read_settlement'
] as const;

describe('production database gates', () => {
  let pool: Pool;

  beforeAll(() => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      throw new Error(
        'TEST_DATABASE_URL is required for production database gate tests. Do not mock the database.'
      );
    }
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has tables needed by the production customer, vendor, rider, admin, payment, and settlement flows', async () => {
    const result = await pool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [requiredTables]
    );

    expect(new Set(result.rows.map((row) => row.table_name))).toEqual(new Set(requiredTables));
  });

  it('has database functions for critical order, inventory, payment, delivery, escalation, and settlement operations', async () => {
    const result = await pool.query<{ proname: string }>(
      `
        select distinct p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[])
      `,
      [requiredFunctions]
    );

    expect(new Set(result.rows.map((row) => row.proname))).toEqual(new Set(requiredFunctions));
  });

  it('keeps row-level security enabled on tenant and financial tables', async () => {
    const securedTables = [
      'profiles',
      'campus_memberships',
      'admin_memberships',
      'vendors',
      'vendor_users',
      'riders',
      'orders',
      'payments',
      'refunds',
      'settlements',
      'settlement_lines',
      'delivery_batches',
      'delivery_assignments',
      'escalations',
      'notifications',
      'notification_preferences'
    ];

    const result = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `
        select c.relname, c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any($1::text[])
      `,
      [securedTables]
    );

    expect(result.rows).toHaveLength(securedTables.length);
    expect(result.rows.filter((row) => !row.relrowsecurity)).toEqual([]);
  });
});
