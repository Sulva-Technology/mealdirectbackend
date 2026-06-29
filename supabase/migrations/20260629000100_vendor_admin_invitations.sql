-- Admin-issued vendor invitations. Keeps vendor account creation tied to a
-- actual admin actor while storing only a hash of the one-time invite token.

alter table public.vendors
  add column if not exists created_by_admin_id uuid references public.profiles(id);

comment on column public.vendors.created_by_admin_id is 'Admin profile that created this vendor record, when created from the admin portal.';

create table if not exists public.vendor_invitations (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  email extensions.citext not null,
  token_hash text not null unique,
  created_by_admin_id uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_by_user_id uuid references public.profiles(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vendor_invitations_token_hash_not_blank check (length(btrim(token_hash)) > 0),
  constraint vendor_invitations_acceptance_pair check (
    (accepted_at is null and accepted_by_user_id is null)
    or (accepted_at is not null and accepted_by_user_id is not null)
  )
);

comment on table public.vendor_invitations is 'One-time admin-created links that let approved vendor owners create their account and bind to a vendor.';
comment on column public.vendor_invitations.token_hash is 'SHA-256 hash of the one-time invite token; the raw token is returned only when the link is created.';
comment on column public.vendor_invitations.created_by_admin_id is 'Admin profile that generated the invite.';

create index if not exists vendor_invitations_vendor_created_idx
  on public.vendor_invitations (vendor_id, created_at desc);

create index if not exists vendor_invitations_email_open_idx
  on public.vendor_invitations (email, expires_at)
  where accepted_at is null and revoked_at is null;

create index if not exists vendors_created_by_admin_idx
  on public.vendors (created_by_admin_id)
  where created_by_admin_id is not null;

alter table public.vendor_invitations enable row level security;

drop policy if exists vendor_invitations_admin_read on public.vendor_invitations;
create policy vendor_invitations_admin_read
on public.vendor_invitations
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or exists (
    select 1
    from public.vendors v
    where v.id = vendor_invitations.vendor_id
      and public.is_campus_admin(v.campus_id, auth.uid())
  )
);
