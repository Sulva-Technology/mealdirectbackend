begin;

-- Admin refund lifecycle fields. Refunds are mutable (no append-only trigger); these
-- capture failure diagnostics and manual resolution decisions for finance-ops.
alter table public.refunds
  add column if not exists failure_reason text,
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.refunds.failure_reason is 'Provider or manual failure reason recorded when a refund does not succeed.';
comment on column public.refunds.resolution_note is 'Admin note recorded when a refund is manually resolved.';

create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

commit;
