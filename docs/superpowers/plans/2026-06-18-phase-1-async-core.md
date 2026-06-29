# Phase 1 — Async Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain the transactional outbox in a real background worker that delivers email + push notifications, expand the event taxonomy so every order status change is observable, enable Supabase Realtime for live tracking, and make the order quote agree with the database's authoritative pricing.

**Architecture:** A standalone worker process (`src/worker.ts`) polls `public.outbox_events`, leases rows with `for update skip locked`, dispatches each event to handlers registered by `event_type`, and marks each event processed/failed with exponential backoff + dead-lettering. The DB transition functions emit new outbox events; the existing in-app notification trigger is extended to cover them; a worker handler fans those out to email (Resend) and push (FCM) honoring `notification_preferences`. Realtime is enabled via the Postgres publication, governed by existing RLS.

**Tech Stack:** NestJS 11, Kysely + `pg`, Supabase Postgres 15, `@sentry/node` (from Phase 0), Resend, Firebase Admin (FCM), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-18-production-readiness-design.md` (Phase 1).

**Prerequisite:** Phase 0 merged.

---

## Background facts (verified in code)

- `public.outbox_events` columns: `id, event_type, aggregate_type, aggregate_id, payload,
available_at, attempts, locked_at, locked_by, processed_at, last_error, created_at`
  (`migration 400:432`). Partial index `outbox_events_available_idx (available_at, attempts)
where processed_at is null and locked_at is null`.
- An atomic claim already exists in `JobsRepository.claimAvailableOutboxEvents` (uses
  `for update skip locked`) — the worker repository mirrors it and adds completion/failure.
- The trigger `public.create_notification_for_outbox_event()` (`migration 600:83`) already
  materializes in-app notifications, but only for `aggregate_type='order'` and only three
  event types. Extend its `case` mappings for new events.
- `notification_preferences` has `in_app_enabled, push_enabled, email_enabled` +
  per-topic flags; `notification_topic_enabled(prefs, event_type)` maps `order.*`,
  `payment.*`, `delivery.*`, `order.escalation_*`, `settlement.*` to topics.
- DB order statuses (authoritative): `pending_payment, paid, accepted, preparing, ready,
out_for_delivery, delivered, confirmed, administratively_completed, cancelled, expired,
refunded` (`transition_order_status`, `migration 400:887`).
- Order totals are computed in `create_pending_order_and_reserve_inventory`; `orders` has
  `food_subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo`.

---

## File Structure

- `supabase/migrations/<ts>_outbox_worker_lifecycle.sql` — `failed_at` column + claim/complete/fail functions (create).
- `supabase/migrations/<ts>_emit_order_lifecycle_events.sql` — emit events in transition/assignment funcs + extend notification trigger mapping (create).
- `supabase/migrations/<ts>_device_tokens.sql` — push device token table + RLS (create).
- `supabase/migrations/<ts>_notification_deliveries.sql` — per-channel delivery log (create).
- `supabase/migrations/<ts>_enable_realtime.sql` — add tables to `supabase_realtime` publication (create).
- `supabase/tests/database/*` — pgTAP tests for each migration above (create).
- `src/worker/outbox.repository.ts` — claim/complete/fail data access (create).
- `src/worker/outbox-processor.ts` — poll loop + dispatch (create).
- `src/worker/handler-registry.ts` — `event_type → handler[]` registry (create).
- `src/worker/handlers/notification-dispatch.handler.ts` — fan-out to channels (create).
- `src/worker/worker.module.ts` — worker DI wiring (create).
- `src/notifications/channels/notification-channel.ts` — channel interface + types (create).
- `src/notifications/channels/email.channel.ts` — Resend impl (create).
- `src/notifications/channels/push.channel.ts` — FCM impl (create).
- `src/modules/notifications/device-tokens.controller.ts` — register/unregister push tokens (create).
- `src/modules/notifications/device-tokens.repository.ts` — token persistence (create).
- `src/worker.ts` — replace no-op bootstrap with the processor (modify).
- `src/config/env.ts` — Resend + FCM + worker tuning env (modify).
- `src/modules/orders/orders.service.ts` — quote via `calculateOrderPricing` from DB-config fee (modify).
- `docs/api-reference.md` — Realtime subscription contract (modify).
- Tests under `test/unit` and `test/integration` per task.

---

## Task 1: Outbox lifecycle DB functions

Give the worker atomic claim, completion, and failure-with-backoff + dead-lettering.

**Files:**

- Create: `supabase/migrations/<ts>_outbox_worker_lifecycle.sql`
- Create: `supabase/tests/database/outbox_worker_lifecycle_test.sql`

- [ ] **Step 1: Create the migration**

Generate the file with `supabase migration new outbox_worker_lifecycle`, then:

```sql
begin;

alter table public.outbox_events
  add column if not exists failed_at timestamptz;

create index if not exists outbox_events_failed_idx
  on public.outbox_events (failed_at) where failed_at is not null;

-- Atomically lease up to p_limit available events to a worker.
create or replace function public.claim_outbox_batch(p_worker_id text, p_limit integer)
returns setof public.outbox_events
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id from public.outbox_events
    where processed_at is null and failed_at is null
      and locked_at is null and available_at <= now()
    order by available_at asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.outbox_events oe
  set locked_at = now(), locked_by = p_worker_id, attempts = attempts + 1
  from claimed where oe.id = claimed.id
  returning oe.*;
$$;

-- Mark a leased event processed.
create or replace function public.complete_outbox_event(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.outbox_events
  set processed_at = now(), locked_at = null, locked_by = null, last_error = null
  where id = p_id;
$$;

-- Release a failed event with exponential backoff, or dead-letter past max attempts.
create or replace function public.fail_outbox_event(
  p_id uuid, p_error text, p_max_attempts integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.outbox_events where id = p_id;
  if v_attempts >= p_max_attempts then
    update public.outbox_events
    set failed_at = now(), locked_at = null, locked_by = null, last_error = p_error
    where id = p_id;
  else
    update public.outbox_events
    set locked_at = null, locked_by = null, last_error = p_error,
        available_at = now() + (interval '1 second' * power(2, v_attempts))
    where id = p_id;
  end if;
end;
$$;

commit;
```

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/database/outbox_worker_lifecycle_test.sql`:

```sql
begin;
select plan(4);

insert into public.outbox_events (id, event_type, aggregate_type, aggregate_id)
values ('00000000-0000-0000-0000-0000000000aa', 'test.event', 'order', gen_random_uuid());

select is(
  (select count(*)::int from public.claim_outbox_batch('w1', 10)),
  1, 'claim_outbox_batch leases the available event'
);

select ok(
  (select locked_by = 'w1' and attempts = 1 from public.outbox_events
   where id = '00000000-0000-0000-0000-0000000000aa'),
  'claim sets locked_by and increments attempts'
);

select public.fail_outbox_event('00000000-0000-0000-0000-0000000000aa', 'boom', 5);
select ok(
  (select locked_at is null and available_at > now() and last_error = 'boom'
   from public.outbox_events where id = '00000000-0000-0000-0000-0000000000aa'),
  'fail releases lock and backs off when under max attempts'
);

select public.complete_outbox_event('00000000-0000-0000-0000-0000000000aa');
select ok(
  (select processed_at is not null from public.outbox_events
   where id = '00000000-0000-0000-0000-0000000000aa'),
  'complete marks the event processed'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Reset + test + lint**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint`
Expected: the 4 new assertions PASS; lint clean.

- [ ] **Step 4: Regenerate DB types + commit**

Run: `pnpm db:types`

```bash
git add supabase/migrations supabase/tests/database/outbox_worker_lifecycle_test.sql supabase/types/database.types.ts
git commit -m "feat(db): add outbox worker claim/complete/fail lifecycle"
```

---

## Task 2: Emit order-lifecycle events + extend notification mapping

Make every meaningful state change emit an outbox event and a matching in-app notification.

**Files:**

- Create: `supabase/migrations/<ts>_emit_order_lifecycle_events.sql`
- Create: `supabase/tests/database/order_lifecycle_events_test.sql`

- [ ] **Step 1: Create the migration**

Generate with `supabase migration new emit_order_lifecycle_events`. Add an emit at the end of
`transition_order_status` (re-create the whole function copying its current body from
`migration 400:887-960`, then insert before `return p_to_status;`):

```sql
  insert into public.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'order.' || p_to_status::text,
    'order',
    p_order_id,
    jsonb_build_object('from_status', v_from_status::text, 'to_status', p_to_status::text)
  );
```

Then extend the notification mapping by re-creating `create_notification_for_outbox_event`
(copy from `migration 600:83-164`) and replacing the two `case` blocks with full coverage:

```sql
  v_title := case new.event_type
    when 'order.pending_payment_created' then 'Order created'
    when 'payment.successful' then 'Payment received'
    when 'order.accepted' then 'Order accepted'
    when 'order.preparing' then 'Order is being prepared'
    when 'order.ready' then 'Order ready'
    when 'order.out_for_delivery' then 'Out for delivery'
    when 'order.delivered' then 'Delivered'
    when 'order.confirmed' then 'Delivery confirmed'
    when 'order.cancelled' then 'Order cancelled'
    when 'order.refunded' then 'Order refunded'
    when 'order.escalation_opened' then 'Escalation opened'
    else null
  end;

  v_body := case new.event_type
    when 'order.pending_payment_created' then 'Your order is waiting for payment.'
    when 'payment.successful' then 'Your payment was verified successfully.'
    when 'order.accepted' then 'The vendor accepted your order.'
    when 'order.preparing' then 'The vendor is preparing your order.'
    when 'order.ready' then 'Your order is ready for pickup by a rider.'
    when 'order.out_for_delivery' then 'Your rider is on the way.'
    when 'order.delivered' then 'Your order was delivered.'
    when 'order.confirmed' then 'Thanks for confirming your delivery.'
    when 'order.cancelled' then 'Your order was cancelled.'
    when 'order.refunded' then 'Your order was refunded.'
    when 'order.escalation_opened' then 'Your issue was sent to the campus admin team.'
    else null
  end;
```

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/database/order_lifecycle_events_test.sql` that seeds a paid order
(reuse helpers/patterns from existing `supabase/tests/database` order tests), calls
`transition_order_status(order, 'accepted')`, and asserts:

```sql
select ok(
  exists (select 1 from public.outbox_events
          where aggregate_id = :order_id and event_type = 'order.accepted'),
  'accepting an order emits order.accepted'
);
select ok(
  exists (select 1 from public.notifications
          where aggregate_id = :order_id and event_type = 'order.accepted'),
  'order.accepted materializes an in-app notification'
);
```

(Use the same seeding approach as the existing status/history pgTAP test in that folder;
read it first to match fixture style.)

- [ ] **Step 3: Reset + test + lint + types + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types`
Expected: new assertions PASS.

```bash
git add supabase/migrations supabase/tests/database/order_lifecycle_events_test.sql supabase/types/database.types.ts
git commit -m "feat(db): emit outbox events for order lifecycle transitions"
```

---

## Task 3: Worker outbox repository + processor + handler registry

**Files:**

- Create: `src/worker/outbox.repository.ts`, `src/worker/handler-registry.ts`, `src/worker/outbox-processor.ts`
- Create: `test/unit/outbox-processor.spec.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Add worker tuning env**

In `src/config/env.ts` `z.object`, add:

```ts
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
```

- [ ] **Step 2: Write the failing processor test**

Create `test/unit/outbox-processor.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { HandlerRegistry } from '../../src/worker/handler-registry.js';
import { OutboxProcessor } from '../../src/worker/outbox-processor.js';
import type { OutboxEvent, OutboxRepositoryContract } from '../../src/worker/outbox.repository.js';

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'evt-1',
    eventType: 'order.accepted',
    aggregateType: 'order',
    aggregateId: 'ord-1',
    payload: {},
    attempts: 1,
    ...overrides
  };
}

describe('OutboxProcessor.drainOnce', () => {
  it('completes events whose handlers all succeed', async () => {
    const repo: OutboxRepositoryContract = {
      claimBatch: vi.fn().mockResolvedValue([event()]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined)
    };
    const registry = new HandlerRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('order.accepted', handler);

    const processor = new OutboxProcessor(repo, registry, { batchSize: 10, maxAttempts: 5 });
    const count = await processor.drainOnce('w1');

    expect(count).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith('evt-1');
    expect(repo.fail).not.toHaveBeenCalled();
  });

  it('fails the event when a handler throws', async () => {
    const repo: OutboxRepositoryContract = {
      claimBatch: vi.fn().mockResolvedValue([event()]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined)
    };
    const registry = new HandlerRegistry();
    registry.register('order.accepted', vi.fn().mockRejectedValue(new Error('boom')));

    const processor = new OutboxProcessor(repo, registry, { batchSize: 10, maxAttempts: 5 });
    await processor.drainOnce('w1');

    expect(repo.fail).toHaveBeenCalledWith('evt-1', expect.stringContaining('boom'), 5);
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('completes events with no registered handler (no-op)', async () => {
    const repo: OutboxRepositoryContract = {
      claimBatch: vi.fn().mockResolvedValue([event({ eventType: 'unmapped.event' })]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined)
    };
    const processor = new OutboxProcessor(repo, new HandlerRegistry(), {
      batchSize: 10,
      maxAttempts: 5
    });
    await processor.drainOnce('w1');
    expect(repo.complete).toHaveBeenCalledWith('evt-1');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/unit/outbox-processor.spec.ts`
Expected: FAIL — modules do not exist yet.

- [ ] **Step 4: Implement the registry**

Create `src/worker/handler-registry.ts`:

```ts
import type { OutboxEvent } from './outbox.repository.js';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  handlersFor(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }
}
```

- [ ] **Step 5: Implement the repository contract + processor**

Create `src/worker/outbox.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../database/database.service.js';

export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export interface OutboxRepositoryContract {
  claimBatch(workerId: string, limit: number): Promise<OutboxEvent[]>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, maxAttempts: number): Promise<void>;
}

@Injectable()
export class OutboxRepository implements OutboxRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async claimBatch(workerId: string, limit: number): Promise<OutboxEvent[]> {
    const result = await sql<OutboxEvent>`
      select id::text as "id", event_type as "eventType", aggregate_type as "aggregateType",
             aggregate_id::text as "aggregateId", payload, attempts
      from public.claim_outbox_batch(${workerId}, ${limit})
    `.execute(this.database.db);
    return result.rows;
  }

  async complete(id: string): Promise<void> {
    await sql`select public.complete_outbox_event(${id}::uuid)`.execute(this.database.db);
  }

  async fail(id: string, error: string, maxAttempts: number): Promise<void> {
    await sql`select public.fail_outbox_event(${id}::uuid, ${error}, ${maxAttempts})`.execute(
      this.database.db
    );
  }
}
```

Create `src/worker/outbox-processor.ts`:

```ts
import type { HandlerRegistry } from './handler-registry.js';
import type { OutboxRepositoryContract } from './outbox.repository.js';

export type ProcessorConfig = { batchSize: number; maxAttempts: number };

export class OutboxProcessor {
  constructor(
    private readonly repository: OutboxRepositoryContract,
    private readonly registry: HandlerRegistry,
    private readonly config: ProcessorConfig
  ) {}

  async drainOnce(workerId: string): Promise<number> {
    const events = await this.repository.claimBatch(workerId, this.config.batchSize);
    for (const event of events) {
      try {
        for (const handler of this.registry.handlersFor(event.eventType)) {
          await handler(event);
        }
        await this.repository.complete(event.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown handler failure';
        await this.repository.fail(event.id, message, this.config.maxAttempts);
      }
    }
    return events.length;
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run test/unit/outbox-processor.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/worker/outbox.repository.ts src/worker/handler-registry.ts \
  src/worker/outbox-processor.ts src/config/env.ts test/unit/outbox-processor.spec.ts
git commit -m "feat(worker): add outbox processor, registry, and repository"
```

---

## Task 4: Email channel (Resend)

**Files:**

- Create: `src/notifications/channels/notification-channel.ts`, `src/notifications/channels/email.channel.ts`
- Create: `test/unit/email-channel.spec.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Add email env**

In `src/config/env.ts` `z.object`, add:

```ts
    RESEND_API_KEY: optionalSecret,
    EMAIL_FROM: z.string().min(1).default('Meal Direct <no-reply@mealdirect.com>'),
```

And in `superRefine`, require the key outside dev/test:

```ts
if ((env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') && !env.RESEND_API_KEY) {
  context.addIssue({
    code: 'custom',
    path: ['RESEND_API_KEY'],
    message: 'RESEND_API_KEY must be configured outside development and test'
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/email-channel.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { EmailChannel } from '../../src/notifications/channels/email.channel.js';

describe('EmailChannel', () => {
  it('sends via the injected transport with from/to/subject/body', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = new EmailChannel({ send }, 'Meal Direct <no-reply@mealdirect.com>');

    await channel.deliver({
      to: 'user@example.com',
      title: 'Delivered',
      body: 'Your order was delivered.',
      linkPath: '/orders/1'
    });

    expect(send).toHaveBeenCalledWith({
      from: 'Meal Direct <no-reply@mealdirect.com>',
      to: 'user@example.com',
      subject: 'Delivered',
      text: 'Your order was delivered.'
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/unit/email-channel.spec.ts`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement the channel interface + email channel**

Create `src/notifications/channels/notification-channel.ts`:

```ts
export type ChannelMessage = {
  to: string;
  title: string;
  body: string;
  linkPath: string | null;
};

export interface NotificationChannel {
  deliver(message: ChannelMessage): Promise<void>;
}

export interface EmailTransport {
  send(input: { from: string; to: string; subject: string; text: string }): Promise<void>;
}
```

Create `src/notifications/channels/email.channel.ts`:

```ts
import type {
  ChannelMessage,
  EmailTransport,
  NotificationChannel
} from './notification-channel.js';

export class EmailChannel implements NotificationChannel {
  constructor(
    private readonly transport: EmailTransport,
    private readonly from: string
  ) {}

  async deliver(message: ChannelMessage): Promise<void> {
    await this.transport.send({
      from: this.from,
      to: message.to,
      subject: message.title,
      text: message.body
    });
  }
}
```

- [ ] **Step 5: Run to verify pass; install Resend for the real transport**

Run: `pnpm vitest run test/unit/email-channel.spec.ts`
Expected: PASS.
Then: `pnpm add resend` (the real `EmailTransport` wraps `new Resend(apiKey).emails.send`;
wired in the worker module in Task 8-adjacent wiring — see Task 6 module).

- [ ] **Step 6: Commit**

```bash
git add src/notifications/channels/notification-channel.ts \
  src/notifications/channels/email.channel.ts test/unit/email-channel.spec.ts \
  src/config/env.ts package.json pnpm-lock.yaml
git commit -m "feat(notifications): add email channel (Resend transport)"
```

---

## Task 5: Push channel (FCM) + device token registration

**Files:**

- Create: `supabase/migrations/<ts>_device_tokens.sql`, `supabase/tests/database/device_tokens_test.sql`
- Create: `src/notifications/channels/push.channel.ts`
- Create: `src/modules/notifications/device-tokens.repository.ts`, `src/modules/notifications/device-tokens.controller.ts`
- Create: `src/modules/notifications/dto/device-token.dto.ts`
- Create: `test/unit/push-channel.spec.ts`, `test/integration/device-tokens-api.spec.ts`
- Modify: `src/config/env.ts`, `src/modules/notifications/notifications.module.ts`

- [ ] **Step 1: Device tokens migration**

`supabase migration new device_tokens`:

```sql
begin;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_token_unique unique (token)
);

create index device_tokens_user_idx on public.device_tokens (user_id);

create trigger device_tokens_set_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

alter table public.device_tokens enable row level security;
grant select, insert, delete on public.device_tokens to authenticated;

create policy device_tokens_manage_own on public.device_tokens
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;
```

pgTAP `supabase/tests/database/device_tokens_test.sql` asserts the table + unique constraint
exist (mirror an existing table-presence test in the folder).

- [ ] **Step 2: Add FCM env**

In `src/config/env.ts` `z.object`:

```ts
    FCM_PROJECT_ID: optionalSecret,
    FCM_CLIENT_EMAIL: optionalSecret,
    FCM_PRIVATE_KEY: optionalSecret,
```

(No `superRefine` requirement — push degrades gracefully if unconfigured.)

- [ ] **Step 3: Write the failing push-channel test**

Create `test/unit/push-channel.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../../src/notifications/channels/push.channel.js';

describe('PushChannel', () => {
  it('sends a push to every active token for the recipient', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const tokens = { tokensForUser: vi.fn().mockResolvedValue(['t1', 't2']) };
    const channel = new PushChannel(sender, tokens);

    await channel.deliverToUser('user-1', {
      to: 'user-1',
      title: 'Out for delivery',
      body: 'Your rider is on the way.',
      linkPath: '/orders/1'
    });

    expect(tokens.tokensForUser).toHaveBeenCalledWith('user-1');
    expect(sender.send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm vitest run test/unit/push-channel.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implement push channel + token repository**

Create `src/modules/notifications/device-tokens.repository.ts`:

```ts
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
```

Create `src/notifications/channels/push.channel.ts`:

```ts
import type { ChannelMessage } from './notification-channel.js';

export interface PushSender {
  send(input: {
    token: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<void>;
}

export interface TokenLookup {
  tokensForUser(userId: string): Promise<string[]>;
}

export class PushChannel {
  constructor(
    private readonly sender: PushSender,
    private readonly tokens: TokenLookup
  ) {}

  async deliverToUser(userId: string, message: ChannelMessage): Promise<void> {
    const tokens = await this.tokens.tokensForUser(userId);
    await Promise.all(
      tokens.map((token) =>
        this.sender.send({
          token,
          title: message.title,
          body: message.body,
          data: message.linkPath === null ? {} : { linkPath: message.linkPath }
        })
      )
    );
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run test/unit/push-channel.spec.ts`
Expected: PASS. Then `pnpm add firebase-admin` (the real `PushSender` wraps
`messaging().send`, constructed in the worker module).

- [ ] **Step 7: Device token controller + DTO + integration test**

Create `src/modules/notifications/dto/device-token.dto.ts`:

```ts
import { IsIn, IsString, MinLength } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString() @MinLength(1) token!: string;
  @IsIn(['ios', 'android', 'web']) platform!: 'ios' | 'android' | 'web';
}
```

Create `src/modules/notifications/device-tokens.controller.ts`:

```ts
import { Body, Controller, Delete, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { DeviceTokensRepository } from './device-tokens.repository.js';
import { RegisterDeviceTokenDto } from './dto/device-token.dto.js';

@ApiTags('notifications')
@ApiBearerAuth('supabaseAuth')
@Controller('me/device-tokens')
@UseGuards(JwtAuthGuard)
export class DeviceTokensController {
  constructor(
    @Inject(DeviceTokensRepository) private readonly repository: DeviceTokensRepository
  ) {}

  @Post()
  @HttpCode(204)
  async register(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: RegisterDeviceTokenDto
  ): Promise<void> {
    await this.repository.register(actor.userId, dto.token, dto.platform);
  }

  @Delete(':token')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('token') token: string
  ): Promise<void> {
    await this.repository.remove(actor.userId, token);
  }
}
```

Register both in `src/modules/notifications/notifications.module.ts` (`controllers` and
`providers` arrays). Add `test/integration/device-tokens-api.spec.ts` following the existing
`notifications-api.spec.ts` pattern: POST returns 204 and persists, DELETE returns 204, and
an unauthenticated call returns 401.

- [ ] **Step 8: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm typecheck && pnpm vitest run test/unit/push-channel.spec.ts test/integration/device-tokens-api.spec.ts`
Expected: PASS.

```bash
git add supabase/migrations supabase/tests/database/device_tokens_test.sql \
  src/notifications/channels/push.channel.ts src/modules/notifications \
  src/config/env.ts test/unit/push-channel.spec.ts test/integration/device-tokens-api.spec.ts \
  supabase/types/database.types.ts package.json pnpm-lock.yaml
git commit -m "feat(notifications): add FCM push channel and device token registration"
```

---

## Task 6: Notification dispatch handler + delivery log + worker wiring

Wire the worker so each order-related outbox event fans out to email + push for users who
enabled those channels, recording each delivery once.

**Files:**

- Create: `supabase/migrations/<ts>_notification_deliveries.sql`, pgTAP test
- Create: `src/worker/handlers/notification-dispatch.handler.ts`, `test/unit/notification-dispatch.spec.ts`
- Create: `src/worker/worker.module.ts`
- Modify: `src/worker.ts`

- [ ] **Step 1: Delivery log migration**

`supabase migration new notification_deliveries`:

```sql
begin;
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  status text not null check (status in ('sent', 'failed')),
  detail text,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_unique unique (notification_id, channel)
);
create index notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id);
commit;
```

pgTAP asserts table + unique constraint exist.

- [ ] **Step 2: Write the failing handler test**

Create `test/unit/notification-dispatch.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { NotificationDispatchHandler } from '../../src/worker/handlers/notification-dispatch.handler.js';

const recipient = {
  userId: 'u1',
  email: 'u1@example.com',
  emailEnabled: true,
  pushEnabled: true,
  title: 'Delivered',
  body: 'Your order was delivered.',
  linkPath: '/orders/1',
  notificationId: 'n1'
};

describe('NotificationDispatchHandler', () => {
  it('delivers email + push and records both when enabled and not already sent', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue(recipient),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockResolvedValue(undefined) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });

    expect(email.deliver).toHaveBeenCalledTimes(1);
    expect(push.deliverToUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Delivered' })
    );
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'email', 'sent', null);
    expect(reads.recordDelivery).toHaveBeenCalledWith('n1', 'push', 'sent', null);
  });

  it('skips channels the user disabled', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue({ ...recipient, pushEnabled: false }),
      alreadyDelivered: vi.fn().mockResolvedValue(false),
      recordDelivery: vi.fn().mockResolvedValue(undefined)
    };
    const email = { deliver: vi.fn().mockResolvedValue(undefined) };
    const push = { deliverToUser: vi.fn().mockResolvedValue(undefined) };
    const handler = new NotificationDispatchHandler(reads, email, push);

    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });
    expect(push.deliverToUser).not.toHaveBeenCalled();
  });

  it('no-ops when there is no materialized notification recipient', async () => {
    const reads = {
      findRecipientForEvent: vi.fn().mockResolvedValue(undefined),
      alreadyDelivered: vi.fn(),
      recordDelivery: vi.fn()
    };
    const email = { deliver: vi.fn() };
    const push = { deliverToUser: vi.fn() };
    const handler = new NotificationDispatchHandler(reads, email, push);
    await handler.handle({
      id: 'e1',
      eventType: 'order.delivered',
      aggregateType: 'order',
      aggregateId: 'o1',
      payload: {},
      attempts: 1
    });
    expect(email.deliver).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/unit/notification-dispatch.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the handler**

Create `src/worker/handlers/notification-dispatch.handler.ts`:

```ts
import type { EmailChannel } from '../../notifications/channels/email.channel.js';
import type { PushChannel } from '../../notifications/channels/push.channel.js';
import type { OutboxEvent } from '../outbox.repository.js';

export type NotificationRecipient = {
  userId: string;
  email: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  title: string;
  body: string;
  linkPath: string | null;
  notificationId: string;
};

export interface NotificationReads {
  findRecipientForEvent(outboxEventId: string): Promise<NotificationRecipient | undefined>;
  alreadyDelivered(notificationId: string, channel: 'email' | 'push'): Promise<boolean>;
  recordDelivery(
    notificationId: string,
    channel: 'email' | 'push',
    status: 'sent' | 'failed',
    detail: string | null
  ): Promise<void>;
}

export class NotificationDispatchHandler {
  constructor(
    private readonly reads: NotificationReads,
    private readonly email: Pick<EmailChannel, 'deliver'>,
    private readonly push: Pick<PushChannel, 'deliverToUser'>
  ) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    const recipient = await this.reads.findRecipientForEvent(event.id);
    if (recipient === undefined) return;

    const message = {
      to: recipient.email ?? '',
      title: recipient.title,
      body: recipient.body,
      linkPath: recipient.linkPath
    };

    if (
      recipient.emailEnabled &&
      recipient.email !== null &&
      !(await this.reads.alreadyDelivered(recipient.notificationId, 'email'))
    ) {
      await this.email.deliver(message);
      await this.reads.recordDelivery(recipient.notificationId, 'email', 'sent', null);
    }

    if (
      recipient.pushEnabled &&
      !(await this.reads.alreadyDelivered(recipient.notificationId, 'push'))
    ) {
      await this.push.deliverToUser(recipient.userId, message);
      await this.reads.recordDelivery(recipient.notificationId, 'push', 'sent', null);
    }
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/unit/notification-dispatch.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Implement `NotificationReads` data access + worker module + bootstrap**

Create a `NotificationReads` implementation (in
`src/worker/handlers/notification-reads.repository.ts`) that:

- `findRecipientForEvent`: joins `notifications n` (by `source_outbox_event_id`) →
  `notification_preferences p` (by `recipient_user_id`) → `profiles` for email, returning
  `userId, email, emailEnabled, pushEnabled, title, body, linkPath, notificationId`.
- `alreadyDelivered`: `select exists(... notification_deliveries where notification_id and channel)`.
- `recordDelivery`: insert into `notification_deliveries` `on conflict do nothing`.

Create `src/worker/worker.module.ts` providing `DatabaseModule`, `EnvModule`,
`OutboxRepository`, the reads repository, the channels (real Resend/FCM transports built
from env, falling back to a no-op transport when unconfigured), the dispatch handler, and a
`HandlerRegistry` registering `notification-dispatch.handle` for every `order.*`,
`payment.*`, and `settlement.*` event.

Replace `src/worker.ts` bootstrap body (keep env loading + shutdown handlers) with:

```ts
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
const logger = app.get(JsonLogger);
app.useLogger(logger);

const processor = app.get(OutboxProcessor);
const env = app.get(EnvService);
const workerId = `worker:${process.pid}`;
let running = true;

const tick = async (): Promise<void> => {
  while (running) {
    try {
      const drained = await processor.drainOnce(workerId);
      if (drained === 0) {
        await new Promise((resolve) => setTimeout(resolve, env.get('WORKER_POLL_INTERVAL_MS')));
      }
    } catch (error) {
      logger.error(
        {
          message: 'Worker tick failed',
          error: error instanceof Error ? error.message : 'unknown'
        },
        undefined,
        'Worker'
      );
      await new Promise((resolve) => setTimeout(resolve, env.get('WORKER_POLL_INTERVAL_MS')));
    }
  }
};

const shutdown = async (): Promise<void> => {
  running = false;
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
void tick();
```

(Provide `OutboxProcessor` from the module via a factory using `WORKER_BATCH_SIZE` /
`WORKER_MAX_ATTEMPTS`.)

- [ ] **Step 7: Integration test — full drain**

Create `test/integration/worker-outbox.spec.ts`: insert an `order.delivered` outbox event +
matching notification + preferences with email enabled and a fake email transport; run
`processor.drainOnce`; assert the event is processed and a `notification_deliveries` row
exists. (Use the existing integration DB harness.)

- [ ] **Step 8: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm typecheck && pnpm vitest run test/unit test/integration/worker-outbox.spec.ts`
Expected: PASS.

```bash
git add supabase/migrations supabase/tests/database src/worker test/unit/notification-dispatch.spec.ts \
  test/integration/worker-outbox.spec.ts supabase/types/database.types.ts
git commit -m "feat(worker): dispatch outbox events to email + push with delivery log"
```

---

## Task 7: Enable Supabase Realtime

**Files:**

- Create: `supabase/migrations/<ts>_enable_realtime.sql`, pgTAP test
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Publication migration**

`supabase migration new enable_realtime`:

```sql
begin;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.delivery_assignments;
commit;
```

- [ ] **Step 2: pgTAP test**

Create `supabase/tests/database/realtime_publication_test.sql`:

```sql
begin;
select plan(3);
select ok((select exists(select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='orders')), 'orders in realtime publication');
select ok((select exists(select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='notifications')), 'notifications in realtime publication');
select ok((select exists(select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_assignments')), 'delivery_assignments in realtime publication');
select * from finish();
rollback;
```

- [ ] **Step 3: Document the subscription contract**

Add a "Realtime" section to `docs/api-reference.md` describing: clients subscribe via
`supabase-js` to `postgres_changes` on `public.orders` filtered by `customer_id=eq.<uid>`,
`public.notifications` by `recipient_user_id=eq.<uid>`, and `public.delivery_assignments`
for riders; access is enforced by existing RLS over the authenticated Realtime channel; row
shapes match the REST list payloads.

- [ ] **Step 4: Verify + commit**

Run: `pnpm db:reset && pnpm db:test && pnpm db:lint`
Expected: 3 assertions PASS.

```bash
git add supabase/migrations supabase/tests/database/realtime_publication_test.sql docs/api-reference.md
git commit -m "feat(db): enable Supabase Realtime for orders, notifications, assignments"
```

---

## Task 8: Make the order quote agree with DB pricing

The authoritative total is computed in `create_pending_order_and_reserve_inventory`; the TS
quote must use the same delivery + service fee source so the displayed quote matches the
created order. Route the quote through `calculateOrderPricing`.

**Files:**

- Modify: `src/config/env.ts`, `src/modules/orders/orders.service.ts`
- Modify: `test/unit/orders.service.spec.ts`

- [ ] **Step 1: Add pricing config env**

In `src/config/env.ts` `z.object`:

```ts
    DELIVERY_FEE_KOBO: z.coerce.number().int().nonnegative().default(15_000),
    SERVICE_FEE_KOBO: z.coerce.number().int().nonnegative().default(0),
```

(These must match the constants used inside `create_pending_order_and_reserve_inventory`.
If the DB function hardcodes the fee, update that function in this migration set to read the
same default so quote and order stay consistent — verify by reading the function body first.)

- [ ] **Step 2: Update the orders.service test**

In `test/unit/orders.service.spec.ts`, change the quote expectation so the total equals
`calculateOrderPricing({ lines, deliveryFeeCents: DELIVERY_FEE_KOBO, serviceFeeCents: SERVICE_FEE_KOBO }).totalCents`
for a sample basket (add a case asserting service fee is included when configured).

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/unit/orders.service.spec.ts`
Expected: FAIL (service still uses hardcoded constants / omits service fee).

- [ ] **Step 4: Wire the domain calculator**

In `src/modules/orders/orders.service.ts`, replace the module-level `deliveryFeeKobo` /
`discountKobo` constants and inline math in `quoteOrder` with a call to
`calculateOrderPricing`, sourcing `deliveryFeeCents`/`serviceFeeCents` from `EnvService`
(inject `EnvService`). Map the resulting `OrderPricing` to the existing `OrderQuote` shape
(`foodSubtotalKobo`, `deliveryFeeKobo`, `discountKobo`, `totalKobo`, plus a new
`serviceFeeKobo` field on `OrderQuote`).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/unit/orders.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm openapi:generate`
Expected: PASS; OpenAPI updated for the new `serviceFeeKobo` field.

```bash
git add src/config/env.ts src/modules/orders/orders.service.ts src/modules/orders/orders.types.ts \
  test/unit/orders.service.spec.ts docs/openapi.json docs/openapi.yaml
git commit -m "feat(orders): compute quote via domain pricing calculator"
```

---

## Self-Review

- **Spec coverage (Phase 1):** outbox worker → Tasks 1, 3, 6; event taxonomy → Task 2;
  email + push channels → Tasks 4, 5, 6; device tokens → Task 5; delivery log/idempotency →
  Task 6; Supabase Realtime → Task 7; pricing wiring → Task 8. Covered.
- **Placeholder scan:** `<ts>` denotes the migration timestamp from `supabase migration new`;
  Task 2 Step 2, Task 5 Step 1 (pgTAP), Task 6 Step 6, and Task 8 Step 1 instruct reading an
  existing file/function to match fixtures/constants — these are grounding steps, not vague
  requirements; all code steps include full code.
- **Type consistency:** `OutboxEvent` (`id,eventType,aggregateType,aggregateId,payload,attempts`),
  `OutboxRepositoryContract.{claimBatch,complete,fail}`, `ChannelMessage`,
  `NotificationChannel.deliver`, `PushChannel.deliverToUser`, and `NotificationReads` are used
  consistently across processor, handlers, and tests.

## Known follow-through into later phases

- The DB `order_status` enum vs TS `order-status.ts` mismatch (`ready_for_pickup`/`picked_up`/
  `completed`/`escalated` vs `ready`/`out_for_delivery`/`administratively_completed`/`expired`)
  should be reconciled in Phase 2 when dispatch touches these transitions. Phase 1 emits events
  using the authoritative DB names.
