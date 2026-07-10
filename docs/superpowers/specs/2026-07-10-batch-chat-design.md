# Batch Chat — Design Spec

Date: 2026-07-10
Status: Approved

## Goal

Real-time group chat scoped to a delivery batch. Rider posts announcements; customers
on that batch see them instantly and get push notifications. Two-way: customers can
reply. Customer identities are pseudonymised (`Customer 1`, `Customer 2`, …) so
customers never see each other's real names or room numbers. Vendor participation is
plumbed but hidden for v1.

## Decisions (from brainstorm)

- **Q1 direction**: Two-way group chat + pseudonymous labels.
- **Q2 delivery**: Supabase Realtime (live, foreground) + existing FCM outbox push
  (background). Reuses existing outbox → notifications → dispatch → FCM pipeline.
- **Q3 lifecycle**: Customer joins when their order is added to a batch. Chat opens at
  batch creation. Batch `completed`/`cancelled` → read-only (history stays readable).
- **Q4 push fan-out (asymmetric)**: rider message → push all customer participants;
  customer message → push rider only. Sender always excluded. Vendor excluded (hidden).
- **Vendor**: participant row created but `hidden = true`; not surfaced client-side.

## Privacy model

The Realtime-published `batch_messages` row must never contain a real name or room
number. Row carries only `sender_user_id` (opaque UUID), `sender_label` (pseudonym
snapshot), `sender_role`, `body`, `created_at`. Real names live only in the
participant roster, which is resolved through an authorised endpoint:

- Customer roster view → pseudonyms only.
- Rider roster view → real customer names (rider already sees these in the assignment
  manifest; needed to deliver).

RLS restricts both tables to batch participants. `INSERT` on `batch_messages` forces
`sender_user_id = auth.uid()`; a BEFORE trigger stamps `sender_label`/`sender_role`
from the participant row (client cannot spoof identity or label) and rejects
non-participants and closed batches.

## Data model (new)

### `batch_chat_participants`
- `batch_id uuid`, `user_id uuid`, PK (`batch_id`, `user_id`)
- `role text` — `rider` | `customer` | `vendor`
- `label text` — pseudonym snapshot: rider→display name; customer→`Customer N`
  (N = stable join order within the batch); vendor→`Vendor`
- `hidden boolean` default false (vendor rows = true)
- `joined_at timestamptz`

Population:
- Customer: trigger on `delivery_batch_orders` INSERT (order → `orders.customer_id`).
- Rider: trigger on `delivery_assignments` INSERT/UPDATE when `rider_id` set.
- Vendor: from batch `vendor_id`, `hidden = true`.
- Backfill for existing batches in the migration.

### `batch_messages` (Realtime-published)
- `id uuid`, `batch_id uuid`
- `sender_user_id uuid`, `sender_label text`, `sender_role text`
- `body text` (length-capped, non-blank)
- `created_at timestamptz`
- Index (`batch_id`, `created_at desc`, `id desc`) for keyset history.

### `notification_preferences`
- Add `batch_chat_enabled boolean not null default true`.
- Extend `notification_topic_enabled`: `batch_chat.%` → `batch_chat_enabled`.

## Event flow

1. `POST /batches/:id/chat/messages` → insert `batch_messages` (BEFORE trigger stamps
   sender label/role, guards participant + open batch).
2. Supabase Realtime publishes the INSERT to subscribed participants (live).
3. AFTER trigger on `batch_messages` inserts an `outbox_events` row
   (`event_type = 'batch_chat.message'`, `aggregate_type = 'batch_chat'`,
   `aggregate_id = batch_id`, payload `{ message_id, sender_user_id, sender_role }`).
4. AFTER-insert trigger `create_batch_chat_notifications()` on `outbox_events`
   materialises `notifications` rows for the asymmetric recipient set, honouring
   `in_app_enabled` + `batch_chat_enabled`. Title/body pseudonymised
   (`New message from {sender_label}`). `link_path = /batches/:id/chat`.
5. Worker registry gains prefix `batch_chat.` → existing `NotificationDispatchHandler`
   → FCM push. `notification-reads` forces `emailEnabled = false` for `batch_chat.%`
   (no chat email spam).

## API surface (new)

Guarded by `JwtAuthGuard` only; participant check in service (posters span roles).

- `POST /batches/:batchId/chat/messages` `{ body }` → created message.
- `GET  /batches/:batchId/chat/messages?cursor=&limit=` → keyset history.
- `GET  /batches/:batchId/chat/participants` → roster (pseudonyms; rider view resolves
  real names).

Client subscribes to Supabase Realtime on `batch_messages` filtered by `batch_id`;
unsubscribes on close. Background delivery via FCM.

## Module layout

`src/modules/chat/` — `chat.module.ts`, `chat.controller.ts`, `chat.service.ts`,
`chat.repository.ts`, `chat.types.ts`, `dto/chat.dto.ts`. Registered in `app.module`.
Worker wiring in `worker.module.ts` + `notification-reads.repository.ts`.

## Testing

- Unit (`chat.service`): non-participant rejected, closed-batch rejected, post/list happy path.
- Integration: RLS (non-participant SELECT/INSERT denied; spoofed `sender_user_id` denied);
  post → message row + notifications materialised for correct recipients (asymmetric).
- DB tests: `Customer N` label stability; participant backfill; read-only after complete.

## Out of scope (v1)

- Frontend integration in mealuser/mealrider/mealvendor/mealadmin (separate slices).
- Vendor-visible chat, typing indicators, read receipts, attachments, message edit/delete.
