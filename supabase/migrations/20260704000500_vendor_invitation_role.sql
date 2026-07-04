-- Vendor invitations now carry the role the invitee is granted on accept, so
-- admins can invite staff (not just owners) by email + one-time signup link.

-- Add nullable first, backfill existing rows to 'owner' (every prior invite
-- granted owner on accept), then lock down to not-null with a staff default so
-- new invites match the admin UI default.
alter table public.vendor_invitations
  add column if not exists role public.vendor_user_role;

update public.vendor_invitations
  set role = 'owner'::public.vendor_user_role
  where role is null;

alter table public.vendor_invitations
  alter column role set default 'staff',
  alter column role set not null;

comment on column public.vendor_invitations.role is 'Vendor role (owner|staff) granted to the invitee when the invitation is accepted.';
