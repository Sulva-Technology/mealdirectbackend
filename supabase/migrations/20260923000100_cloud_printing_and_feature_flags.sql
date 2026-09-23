begin;

-- Feature flags with a tester cohort ("test mode"). A flag in mode 'test' is only enabled
-- for users/vendors listed in feature_testers, so a new feature can be exercised on
-- production by test accounts without reaching real vendors. See
-- docs/superpowers/specs/2026-09-23-cloud-printing-and-test-mode-design.md.
create table public.feature_flags (
  key text primary key,
  mode text not null default 'off',
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_format check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint feature_flags_mode_valid check (mode in ('off', 'test', 'on'))
);

comment on table public.feature_flags is 'Per-feature rollout switch: off (nobody), test (feature_testers only), on (everyone). Edited through PATCH /admin/feature-flags and audited.';
comment on column public.feature_flags.mode is 'off | test | on. test enables the feature only for subjects listed in feature_testers.';

create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

alter table public.feature_flags enable row level security;

create table public.feature_testers (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint feature_testers_subject_type_valid check (subject_type in ('user', 'vendor')),
  constraint feature_testers_note_length check (note is null or length(note) <= 500),
  constraint feature_testers_subject_unique unique (subject_type, subject_id)
);

comment on table public.feature_testers is 'Test-mode cohort. A user or vendor listed here sees every feature flag whose mode is test.';
comment on column public.feature_testers.subject_id is 'profiles.id when subject_type = user, vendors.id when subject_type = vendor. Not a FK so one table can hold both.';

alter table public.feature_testers enable row level security;

insert into public.feature_flags (key, mode, description)
values ('cloud_printing', 'test', 'Automatic kitchen-ticket printing on CloudPRNT printers.')
on conflict (key) do nothing;

-- Vendor cloud printers (Star CloudPRNT). The printer polls
-- /v1/printers/cloudprnt/<key>; only the SHA-256 of that key is stored.
create table public.vendor_printers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  mac_address text not null,
  key_hash text not null,
  paper_width_chars integer not null default 48,
  last_seen_at timestamptz,
  last_status_code text,
  created_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_printers_name_length check (length(btrim(name)) between 1 and 80),
  constraint vendor_printers_mac_format check (mac_address ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  constraint vendor_printers_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint vendor_printers_paper_width_valid check (paper_width_chars in (32, 42, 48)),
  constraint vendor_printers_key_hash_unique unique (key_hash)
);

comment on table public.vendor_printers is 'CloudPRNT printers registered by vendors. revoked_at set = key no longer accepted.';
comment on column public.vendor_printers.key_hash is 'Hex SHA-256 of the secret path key the printer polls with. The key itself is shown to the vendor once.';
comment on column public.vendor_printers.mac_address is 'Lower-case colon-separated MAC; must match the MAC the printer reports.';
comment on column public.vendor_printers.paper_width_chars is 'Characters per line: 32 (58mm), 42 or 48 (80mm).';

create unique index vendor_printers_live_mac_unique
  on public.vendor_printers (mac_address)
  where revoked_at is null;

create index vendor_printers_vendor_idx on public.vendor_printers (vendor_id) where revoked_at is null;

create trigger vendor_printers_set_updated_at
before update on public.vendor_printers
for each row execute function public.set_updated_at();

alter table public.vendor_printers enable row level security;

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  order_id uuid references public.orders(id) on delete restrict,
  kind text not null default 'order',
  status text not null default 'pending',
  print_after timestamptz not null default now(),
  attempts integer not null default 0,
  leased_at timestamptz,
  leased_printer_id uuid references public.vendor_printers(id) on delete set null,
  printed_at timestamptz,
  printed_by_printer_id uuid references public.vendor_printers(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_kind_valid check (kind in ('order', 'test')),
  constraint print_jobs_status_valid check (status in ('pending', 'printing', 'printed', 'failed', 'cancelled')),
  constraint print_jobs_order_matches_kind check ((kind = 'order') = (order_id is not null)),
  constraint print_jobs_attempts_non_negative check (attempts >= 0),
  constraint print_jobs_order_unique unique (order_id)
);

comment on table public.print_jobs is 'Kitchen-ticket queue drained by vendor CloudPRNT printers. One row per order (reprint re-queues the same row); kind = test rows are sample tickets.';
comment on column public.print_jobs.print_after is 'Earliest print time: slot cutoff (delivery_time - cutoff_minutes, campus timezone) or payment time if later.';

create index print_jobs_vendor_due_idx on public.print_jobs (vendor_id, status, print_after);

create trigger print_jobs_set_updated_at
before update on public.print_jobs
for each row execute function public.set_updated_at();

alter table public.print_jobs enable row level security;

-- Earliest print time for an order: its slot cutoff in campus local time, never in the past.
create or replace function public.order_print_after(p_order_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    now(),
    ((o.service_date::text || ' ' || ds.delivery_time::text)::timestamp at time zone c.timezone)
      - make_interval(mins => ds.cutoff_minutes)
  )
  from public.orders o
  join public.delivery_slots ds on ds.id = o.delivery_slot_id
  join public.campuses c on c.id = o.campus_id
  where o.id = p_order_id;
$$;

comment on function public.order_print_after(uuid) is 'Print time for an order ticket: slot cutoff in campus timezone, or now() if the cutoff has passed.';

-- Enqueue a ticket when an order first becomes paid, on every path to paid (verify, webhook,
-- reconcile cron, wallet RPC, admin force-paid, expired recovery). Only vendors with a live
-- printer get jobs, so vendors not using printing accumulate nothing.
create or replace function public.enqueue_order_print_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.paid_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.paid_at is not null then
    return new;
  end if;
  if not exists (
    select 1 from public.vendor_printers vp
    where vp.vendor_id = new.vendor_id and vp.revoked_at is null
  ) then
    return new;
  end if;

  insert into public.print_jobs (vendor_id, order_id, kind, print_after)
  values (new.vendor_id, new.id, 'order', coalesce(public.order_print_after(new.id), now()))
  on conflict (order_id) do nothing;

  return new;
end;
$$;

comment on function public.enqueue_order_print_job() is 'AFTER trigger on orders: queues a print_jobs row the first time paid_at is set, if the vendor has a live printer.';

create trigger orders_enqueue_print_job
after insert or update of paid_at on public.orders
for each row execute function public.enqueue_order_print_job();

-- Return the job this printer should print now, leasing it. Re-returns the printer's own live
-- lease first (the printer re-polls until it fetches), otherwise claims the next due job with
-- SKIP LOCKED so two printers at one vendor never take the same ticket.
create or replace function public.claim_print_job(
  p_printer_id uuid,
  p_lease_seconds integer,
  p_window_hours integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor_id uuid;
  v_job_id uuid;
begin
  select vendor_id into v_vendor_id
  from public.vendor_printers
  where id = p_printer_id and revoked_at is null;

  if v_vendor_id is null then
    return null;
  end if;

  select j.id into v_job_id
  from public.print_jobs j
  where j.leased_printer_id = p_printer_id
    and j.status = 'printing'
    and j.leased_at > now() - make_interval(secs => p_lease_seconds)
  order by j.leased_at
  limit 1;

  if v_job_id is not null then
    return v_job_id;
  end if;

  select j.id into v_job_id
  from public.print_jobs j
  left join public.orders o on o.id = j.order_id
  left join public.campus_locations cl on cl.id = o.location_id
  where j.vendor_id = v_vendor_id
    and (
      j.status = 'pending'
      or (j.status = 'printing' and j.leased_at <= now() - make_interval(secs => p_lease_seconds))
    )
    and j.print_after <= now()
    and j.print_after > now() - make_interval(hours => p_window_hours)
    and (j.kind = 'test' or o.order_status not in ('cancelled', 'expired', 'refunded'))
  order by j.print_after, cl.name nulls first, o.room_number nulls first, j.created_at
  limit 1
  for update of j skip locked;

  if v_job_id is null then
    return null;
  end if;

  update public.print_jobs
  set status = 'printing',
      leased_at = now(),
      leased_printer_id = p_printer_id
  where id = v_job_id;

  return v_job_id;
end;
$$;

comment on function public.claim_print_job(uuid, integer, integer) is 'Leases the next due print job for a printer (or returns its current live lease). Skips cancelled/expired/refunded orders and jobs older than the window.';

-- Finalise a leased job after the printer reports. 2xx CloudPRNT code = printed; anything else
-- re-queues, failing permanently after p_max_attempts.
create or replace function public.complete_print_job(
  p_job_id uuid,
  p_printer_id uuid,
  p_success boolean,
  p_error text,
  p_max_attempts integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.print_jobs
  set status = case
        when p_success then 'printed'
        when attempts + 1 >= p_max_attempts then 'failed'
        else 'pending'
      end,
      attempts = case when p_success then attempts else attempts + 1 end,
      printed_at = case when p_success then now() else printed_at end,
      printed_by_printer_id = case when p_success then p_printer_id else printed_by_printer_id end,
      last_error = case when p_success then null else left(p_error, 500) end,
      leased_at = null,
      leased_printer_id = null
  where id = p_job_id
    and status = 'printing'
    and leased_printer_id = p_printer_id
  returning status into v_status;

  return v_status;
end;
$$;

comment on function public.complete_print_job(uuid, uuid, boolean, text, integer) is 'Marks a leased print job printed, or re-queues/fails it on a non-2xx printer code. Returns the new status, or null if the printer does not hold the lease.';

revoke all on function public.order_print_after(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_order_print_job() from public, anon, authenticated;
revoke all on function public.claim_print_job(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_print_job(uuid, uuid, boolean, text, integer) from public, anon, authenticated;

commit;
