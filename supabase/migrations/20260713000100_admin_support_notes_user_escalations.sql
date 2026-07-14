begin;

-- ============================================================================
-- Admin support tooling:
--   1) admin_support_notes — append-only internal notes admins attach to
--      payments, refunds, orders, and users (mealadmin support surfaces).
--   2) escalations.user_id — lets admins open an escalation about a customer
--      without an order (order_id becomes nullable; at least one subject
--      required).
-- ============================================================================

-- 1) Generic admin note store --------------------------------------------------
create table public.admin_support_notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint admin_support_notes_subject_type_check
    check (subject_type in ('payment', 'refund', 'order', 'user')),
  constraint admin_support_notes_body_present check (length(btrim(body)) > 0)
);

create index admin_support_notes_subject_idx
  on public.admin_support_notes (subject_type, subject_id, created_at desc);

comment on table public.admin_support_notes is
  'Append-only internal admin notes attached to payments, refunds, orders, or users.';

-- Sensitive ops data: RLS on, no anon/authenticated policies — only the
-- privileged application role (bypasses RLS) reads/writes.
alter table public.admin_support_notes enable row level security;

-- 2) User-scoped escalations ---------------------------------------------------
alter table public.escalations
  add column user_id uuid references public.profiles(id) on delete restrict;

alter table public.escalations
  alter column order_id drop not null;

alter table public.escalations
  add constraint escalations_subject_present
    check (order_id is not null or user_id is not null);

create index escalations_user_idx on public.escalations (user_id)
  where user_id is not null;

comment on column public.escalations.user_id is
  'Optional customer subject for order-less escalations opened by admins.';

commit;
