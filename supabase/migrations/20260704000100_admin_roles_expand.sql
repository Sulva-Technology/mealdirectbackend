-- Expand admin_role with granular sub-roles used for server-side RBAC. New values are added
-- outside a transaction block and are only *used* by later migrations, so PostgreSQL's
-- "unsafe use of new enum value" restriction does not apply here.
alter type public.admin_role add value if not exists 'finance_admin';
alter type public.admin_role add value if not exists 'operations_admin';
alter type public.admin_role add value if not exists 'support_admin';
alter type public.admin_role add value if not exists 'readonly_admin';
