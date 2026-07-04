begin;

-- Relax the role/scope rule now that granular admin sub-roles exist. Super Admin stays
-- global (no campus); every other admin role may be global or scoped to one campus.
alter table public.admin_memberships
  drop constraint if exists admin_memberships_role_scope;

alter table public.admin_memberships
  add constraint admin_memberships_role_scope check (
    (role = 'super_admin' and campus_id is null)
    or
    (role <> 'super_admin')
  );

commit;
