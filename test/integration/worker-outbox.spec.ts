import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { EnvService } from '../../src/config/env.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { EmailChannel } from '../../src/notifications/channels/email.channel.js';
import { PushChannel } from '../../src/notifications/channels/push.channel.js';
import type { EmailTransport } from '../../src/notifications/channels/notification-channel.js';
import { HandlerRegistry } from '../../src/worker/handler-registry.js';
import { NotificationDispatchHandler } from '../../src/worker/handlers/notification-dispatch.handler.js';
import { NotificationReadsRepository } from '../../src/worker/handlers/notification-reads.repository.js';
import { OutboxProcessor } from '../../src/worker/outbox-processor.js';
import { OutboxRepository } from '../../src/worker/outbox.repository.js';

// This suite needs a live Postgres with the project migrations applied. The default
// integration env points DATABASE_URL at an unreachable port, so opt in by exporting
// WORKER_TEST_DATABASE_URL with a reachable connection string (e.g. the local Supabase DB).
const connectionString = process.env.WORKER_TEST_DATABASE_URL;

describe.skipIf(connectionString === undefined)('worker outbox drain', () => {
  let pool: Pool;
  let database: DatabaseService;
  const orderId = randomUUID();

  beforeAll(() => {
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString, max: 2 });
    database = new DatabaseService(new EnvService());
  });

  afterAll(async () => {
    await pool.query('begin');
    try {
      await pool.query("set local session_replication_role = 'replica'");
      await pool.query('delete from public.notifications where aggregate_id = $1::uuid', [orderId]);
      await pool.query('delete from public.outbox_events where aggregate_id = $1::uuid', [orderId]);
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
    await database.onModuleDestroy();
    await pool.end();
  });

  it('drains an order.delivered event and records an email delivery', async () => {
    // Pick a customer profile with notifications enabled for the email channel.
    const recipient = await pool.query<{ id: string }>('select id from public.profiles limit 1');
    const recipientId = recipient.rows[0]?.id;
    expect(recipientId).toBeDefined();

    await pool.query(
      `insert into public.notification_preferences (user_id, in_app_enabled, email_enabled)
       values ($1::uuid, true, true)
       on conflict (user_id) do update set email_enabled = true, in_app_enabled = true`,
      [recipientId]
    );

    const outbox = await pool.query<{ id: string }>(
      `insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
       values ('order.delivered', 'order', $1::uuid, '{}'::jsonb)
       returning id`,
      [orderId]
    );
    const outboxId = outbox.rows[0]?.id;
    expect(outboxId).toBeDefined();

    await pool.query(
      `insert into public.notifications
         (recipient_user_id, source_outbox_event_id, event_type, aggregate_type, aggregate_id, title, body, link_path)
       values ($1::uuid, $2::uuid, 'order.delivered', 'order', $3::uuid, 'Delivered', 'Your order was delivered.', '/orders/' || $3::text)`,
      [recipientId, outboxId, orderId]
    );

    const sent: { to: string; subject: string }[] = [];
    const transport: EmailTransport = {
      send: (input): Promise<void> => {
        sent.push({ to: input.to, subject: input.subject });
        return Promise.resolve();
      }
    };

    const outboxRepo = new OutboxRepository(database);
    const reads = new NotificationReadsRepository(database);
    const email = new EmailChannel(transport, 'Meal Direct <test@mealdirectly.com>');
    const push = new PushChannel(
      { send: (): Promise<void> => Promise.resolve() },
      { tokensForUser: (): Promise<string[]> => Promise.resolve([]) }
    );
    const dispatch = new NotificationDispatchHandler(reads, email, push);
    const registry = new HandlerRegistry();
    registry.registerPrefix('order.', dispatch.handle);
    const processor = new OutboxProcessor(outboxRepo, registry, { batchSize: 10, maxAttempts: 5 });

    const drained = await processor.drainOnce('worker:test');
    expect(drained).toBeGreaterThanOrEqual(1);
    expect(sent).toHaveLength(1);

    const deliveries = await pool.query<{ channel: string; status: string }>(
      `select d.channel, d.status
       from public.notification_deliveries d
       join public.notifications n on n.id = d.notification_id
       where n.source_outbox_event_id = $1::uuid`,
      [outboxId]
    );
    expect(deliveries.rows).toContainEqual({ channel: 'email', status: 'sent' });
  });
});
