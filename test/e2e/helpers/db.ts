import { Pool } from 'pg';

export function createE2EPool(): Pool {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error('E2E_DATABASE_URL is required.');
  }
  return new Pool({
    connectionString,
    max: 2,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false
  });
}

export async function cleanupOrders(pool: Pool, orderIds: readonly string[]): Promise<void> {
  if (orderIds.length === 0) return;

  await pool.query('begin');
  try {
    await pool.query("set local session_replication_role = 'replica'");
    await pool.query('delete from public.notifications where aggregate_id = any($1::uuid[])', [
      orderIds
    ]);
    await pool.query('delete from public.outbox_events where aggregate_id = any($1::uuid[])', [
      orderIds
    ]);
    await pool.query('delete from public.payment_events where provider_reference like $1', [
      `${process.env.E2E_TEST_NAMESPACE ?? 'e2e'}%`
    ]);
    await pool.query('delete from public.refunds where order_id = any($1::uuid[])', [orderIds]);
    await pool.query('delete from public.payments where order_id = any($1::uuid[])', [orderIds]);
    await pool.query('delete from public.reviews where order_id = any($1::uuid[])', [orderIds]);
    await pool.query('delete from public.escalations where order_id = any($1::uuid[])', [orderIds]);
    await pool.query('delete from public.delivery_confirmations where order_id = any($1::uuid[])', [
      orderIds
    ]);
    await pool.query('delete from public.delivery_batch_orders where order_id = any($1::uuid[])', [
      orderIds
    ]);
    await pool.query('delete from public.order_items where order_id = any($1::uuid[])', [orderIds]);
    await pool.query('delete from public.orders where id = any($1::uuid[])', [orderIds]);
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback');
    throw error;
  }
}

export async function cleanupE2ERefunds(pool: Pool): Promise<void> {
  const namespace = process.env.E2E_TEST_NAMESPACE;
  if (namespace === undefined) {
    throw new Error('E2E_TEST_NAMESPACE is required for refund cleanup.');
  }

  await pool.query('delete from public.refunds where reason_code like $1', [`${namespace}%`]);
}
